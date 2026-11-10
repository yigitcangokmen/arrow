// S3a: does intents.near accept an ERC-191 transfer intent that carries msg and min_gas? (DEC K-03, V-07)
// simulate_intents is a free mainnet view. Default: a throwaway unfunded EOA kept in memory only (S3a(i)).
// --funded: the buyer key from .env (S3a(ii), H-08b, run by the human). --gates-line prints a GATES.md draft.
// Written by WS4-T04; WS1-T08 owns the gate. Nothing is sent or spent: it simulates only.
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arrowTransferIntent, buildPayload, currentSalt, NETWORKS, signPayloadViem, simulateIntents } from "@arrow/sdk";
import { loadEnv, requireEnv } from "../../scripts/src/lib/env.ts";
import { log } from "../../scripts/src/lib/log.ts";

loadEnv();
const { values } = parseArgs({ options: { funded: { type: "boolean", default: false }, "gates-line": { type: "boolean", default: false } } });
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "s3a-results.json");

const account = privateKeyToAccount((values.funded ? requireEnv("E2E_BUYER_EVM_PRIVATE_KEY") : generatePrivateKey()) as `0x${string}`);
const intent = arrowTransferIntent({
  receiverId: "arrow-spike.arrowhq.near",
  tokenId: NETWORKS.mainnet.usdcToken,
  amount: "10000",
  msg: '{"mode":"refund_all"}',
});
const payload = buildPayload({ signer: account.address, intents: [intent], salt: await currentSalt("mainnet") });
const multipayload = await signPayloadViem(payload, account);

const carries = (k: "msg" | "min_gas") => (JSON.parse(multipayload.payload).intents[0][k] === intent[k] ? "yes" : "NO");
log(`mode: ${values.funded ? "funded (S3a(ii))" : "unfunded, in-memory EOA (S3a(i))"}`);
log(`signer: ${account.address.toLowerCase()}`);
log(`signed payload (unsigned body): ${multipayload.payload}`);
log(`payload carries msg: ${carries("msg")} · min_gas: ${carries("min_gas")}`);

let error: string | null = null;
let executed: number | null = null;
try {
  const out = await simulateIntents([multipayload]);
  executed = Array.isArray(out?.intents_executed) ? out.intents_executed.length : null;
} catch (e) {
  error = (e as Error).message;
}

const SIGNATURE_ERROR = /invalid signature|public key|invalid nonce|invalid salt|deadline|wrong verifying_contract|JSON:/;
const BALANCE_ERROR = /insufficient balance or overflow|account '0x[0-9a-f]{40}' not found/;
const cls = error === null ? "OK" : SIGNATURE_ERROR.test(error) ? "SIGNATURE_ERROR" : BALANCE_ERROR.test(error) ? "SIGNATURE_OK_BALANCE_ERROR" : "OTHER";

log(`result: ${error ?? `intents_executed=${executed}`}`);
log(`class: ${cls}`);

writeFileSync(
  OUT,
  JSON.stringify(
    {
      gate: values.funded ? "S3a(ii)" : "S3a(i)",
      timestamp_utc: new Date().toISOString(),
      address: account.address.toLowerCase(),
      carries_msg: carries("msg") === "yes",
      carries_min_gas: carries("min_gas") === "yes",
      payload_body: JSON.parse(multipayload.payload),
      error,
      intents_executed: executed,
      class: cls,
    },
    null,
    2,
  ) + "\n",
);

if (values["gates-line"]) {
  const pass = values.funded ? cls === "OK" : cls === "SIGNATURE_OK_BALANCE_ERROR" || cls === "OK";
  log(`### S3a${values.funded ? "(ii)" : "(i)"} · ${pass ? "PASS" : "FAIL"} · ${new Date().toISOString()}`);
  log(`- Commands: npx tsx spikes/s3/s3a-simulate.ts${values.funded ? " --funded" : ""}`);
  log(`- Evidence: spikes/s3/s3a-results.json · class ${cls} · ${error ?? `intents_executed=${executed}`}`);
}
process.exit(cls === "SIGNATURE_ERROR" || cls === "OTHER" ? 1 : 0);
