// Usage: npx tsx spikes/s3/s3b-notify.ts --mode refund_all|keep [--dry]
// S3b (WS1-T09, H-08c): intents.near transfer with msg → arrow-spike mt_on_transfer → refund_all returns the amount
// (mt_resolve_transfer refunds the buyer), keep returns 0. Checks the S3_NOTIFY log and both Intents balances.
// --dry simulates only (free view, throwaway EOA). The real run is the human's H-08c step.
import { parseArgs } from "node:util";
import { log } from "../../scripts/src/lib/log.ts";
import { AMOUNT, execute, mtBalance, prepare, recordEvidence, SPIKE } from "./intent-run.ts";

const { values } = parseArgs({ options: { mode: { type: "string" }, dry: { type: "boolean", default: false } } });
const mode = values.mode;
if (mode !== "refund_all" && mode !== "keep") {
  console.error("usage: s3b-notify.ts --mode refund_all|keep [--dry]");
  process.exit(2);
}

const { buyer, multipayload } = await prepare(mode, values.dry);
const before = { buyer: await mtBalance(buyer), spike: await mtBalance(SPIKE) };
log(`balances before: buyer ${before.buyer} · spike ${before.spike}`);
if (values.dry) {
  log("dry: nothing sent");
  process.exit(0);
}

const { txHash, signerId } = await execute(multipayload, "FINAL");
const { txStatus } = await import("@arrow/sdk");
const tx = await txStatus("mainnet", txHash, signerId, "FINAL", { archival: true });
const notify: string | undefined = (tx.receipts_outcome ?? [])
  .flatMap((o: { outcome: { logs: string[] } }) => o.outcome.logs)
  .find((l: string) => l.startsWith("S3_NOTIFY"));
const after = { buyer: await mtBalance(buyer), spike: await mtBalance(SPIKE) };
const want = mode === "keep" ? { buyer: -AMOUNT, spike: AMOUNT } : { buyer: 0n, spike: 0n };
const got = { buyer: after.buyer - before.buyer, spike: after.spike - before.spike };
const logOk = !!notify && notify.includes(`sender=${buyer}`) && notify.endsWith(`msg=${JSON.stringify({ mode })}`);
const pass = logOk && got.buyer === want.buyer && got.spike === want.spike;

log(`S3_NOTIFY: ${notify ?? "(missing)"}`);
log(`balances after: buyer ${after.buyer} (${got.buyer}) · spike ${after.spike} (${got.spike}); want ${want.buyer} / ${want.spike}`);
log(`S3b ${mode}: ${pass ? "PASS" : "FAIL"} (log ${logOk ? "ok" : "MISSING OR WRONG"})`);

recordEvidence(
  {
    id: `spike-s3b-${mode}`, kind: "spike", tx: txHash, chain: "near",
    expect: mode === "keep" ? `buyer -${AMOUNT}, spike +${AMOUNT}; S3_NOTIFY with sender and msg` : "buyer and spike unchanged; S3_NOTIFY with sender and msg",
    observed: `buyer ${before.buyer} -> ${after.buyer}, spike ${before.spike} -> ${after.spike}; log ${logOk ? "ok" : "missing"}; ${pass ? "PASS" : "FAIL"}`,
    script: "spikes/s3/s3b-notify.ts",
  },
  signerId,
);
process.exit(pass ? 0 : 1);
