// Usage: npx tsx spikes/s3/s3c-outlayer.ts --mode outlayer|outlayer_refund [--dry]
// S3c (WS1-T09, H-08d): one receipt tree intents.near → arrow-spike mt_on_transfer → OutLayer (chain mode) →
// on_outlayer decides keep (outlayer, ok:true with pm) or refund (outlayer_refund, or any failure).
// Reads S3C_RESULT, the OutLayer request_id and attestation (spikes/s1/read-result.ts), the time from the
// execute_intents block to the last receipt block, and checks the balance change against the decision.
// --dry simulates only (free view, throwaway EOA). The real run is the human's H-08d step.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { log } from "../../scripts/src/lib/log.ts";
import { AMOUNT, execute, mtBalance, prepare, recordEvidence, SPIKE } from "./intent-run.ts";

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: { mode: { type: "string" }, dry: { type: "boolean", default: false } } });
const mode = values.mode;
if (mode !== "outlayer" && mode !== "outlayer_refund") {
  console.error("usage: s3c-outlayer.ts --mode outlayer|outlayer_refund [--dry]");
  process.exit(2);
}

const { buyer, multipayload } = await prepare(mode, values.dry);
const before = { buyer: await mtBalance(buyer), spike: await mtBalance(SPIKE) };
log(`balances before: buyer ${before.buyer} · spike ${before.spike}`);
if (values.dry) {
  log("dry: nothing sent");
  process.exit(0);
}

// The yield can take up to ~118 s, so do not hold the send request open until FINAL.
const { txHash, signerId } = await execute(multipayload, "INCLUDED_FINAL");
const init = JSON.parse(readFileSync(join(here, "init-mainnet.json"), "utf8"));
const r = JSON.parse(
  execFileSync("npx", ["tsx", join(here, "..", "s1", "read-result.ts"), txHash, signerId, "--network", "mainnet", "--input", '{"mode":"echo+ai"}', "--wasm-sha", init.wasm_hash], {
    encoding: "utf8",
  }),
);

const { rpc, txStatus } = await import("@arrow/sdk");
const tx = await txStatus("mainnet", txHash, signerId, "FINAL", { archival: true });
const blockMs = async (hash: string) =>
  Number(BigInt((await rpc<{ header: { timestamp_nanosec: string } }>("mainnet", "block", { block_id: hash }, { archival: true })).header.timestamp_nanosec) / 1_000_000n);
const receiptBlocks = [...new Set<string>((tx.receipts_outcome ?? []).map((o: { block_hash: string }) => o.block_hash))];
const lastReceiptMs = Math.max(...(await Promise.all(receiptBlocks.map(blockMs))));
const elapsedMs = lastReceiptMs - (await blockMs(tx.transaction_outcome.block_hash));

const decision = /decision=(\w+)/.exec(r.result_log_prefix ?? "")?.[1] ?? null;
const wantDecision = mode === "outlayer" ? "keep" : "refund";
const after = { buyer: await mtBalance(buyer), spike: await mtBalance(SPIKE) };
const got = { buyer: after.buyer - before.buyer, spike: after.spike - before.spike };
const want = decision === "keep" ? { buyer: -AMOUNT, spike: AMOUNT } : { buyer: 0n, spike: 0n };
const balancesMatch = got.buyer === want.buyer && got.spike === want.spike;
const attestationOk = r.attestation?.http === 200;
const pass = decision === wantDecision && balancesMatch && elapsedMs < 90_000 && attestationOk;

log(`request_id: ${r.request_id ?? "(none)"} · attestation: https://api.outlayer.ai/attestations/by-request/${r.request_id} (HTTP ${r.attestation?.http ?? "-"})`);
log(`S3C_RESULT: ${r.result_log_prefix ?? "(missing)"} · out ${r.out_bytes ?? "-"} bytes`);
log(`elapsed: tx block -> result ${r.elapsed_ms_chain ?? "-"} ms · tx block -> last receipt ${elapsedMs} ms`);
log(`balances after: buyer ${after.buyer} (${got.buyer}) · spike ${after.spike} (${got.spike}); decision ${decision ?? "-"}, want ${wantDecision}`);
log(`S3c ${mode}: ${pass ? "PASS" : "FAIL"}`);

recordEvidence(
  {
    id: `spike-s3c-${mode}`, kind: "spike", tx: txHash, chain: "near",
    expect: `decision ${wantDecision} < 90 s, balances match the decision, attestation 200`,
    observed: `decision ${decision ?? "missing"}, ${elapsedMs} ms to last receipt, buyer ${before.buyer} -> ${after.buyer}, spike ${before.spike} -> ${after.spike}, request_id ${r.request_id ?? "none"}, attestation ${r.attestation?.http ?? "none"}; ${pass ? "PASS" : "FAIL"}`,
    script: "spikes/s3/s3c-outlayer.ts",
  },
  signerId,
);
process.exit(pass ? 0 : 1);
