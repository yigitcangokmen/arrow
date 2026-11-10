// Usage: npx tsx spikes/s3/s3c-b5-negative.ts --prepare
//        npx tsx spikes/s3/s3c-b5-negative.ts --read <tx_hash> [--signer arrowhq.near]
// B5 negative test (mainnet, human-run): another account calls OutLayer directly with the spike's
// secrets_ref. --prepare writes spikes/s3/out/b5-args.json and prints the near-cli command to run.
// --read prints PASS when OutLayer returned null or the program saw no PROTECTED_MASTER (pm == null).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const init = JSON.parse(readFileSync(join(here, "init-mainnet.json"), "utf8"));
const argsPath = join(here, "out", "b5-args.json");

if (args[0] === "--prepare") {
  mkdirSync(join(here, "out"), { recursive: true });
  const req = {
    source: { WasmUrl: { url: init.wasm_url, hash: init.wasm_hash, build_target: "wasm32-wasip2" } },
    resource_limits: { max_instructions: 2_000_000_000, max_memory_mb: 128, max_execution_seconds: 30 },
    input_data: '{"mode":"echo"}',
    secrets_ref: { profile: init.profile, account_id: "arrow-spike.arrowhq.near" },
    response_format: "Json",
    payer_account_id: null,
    params: null,
  };
  writeFileSync(argsPath, JSON.stringify(req, null, 1) + "\n");
  console.log(`wrote ${argsPath}`);
  console.log("Run (human, mainnet, ~0.02 NEAR deposit, most of it refunded):");
  console.log(
    `  near contract call-function as-transaction outlayer.near request_execution file-args ${argsPath} ` +
      `prepaid-gas '300.0 Tgas' attached-deposit '0.02 NEAR' sign-as arrowhq.near network-config mainnet sign-with-keychain send`,
  );
  console.log("Then: npx tsx spikes/s3/s3c-b5-negative.ts --read <tx_hash>");
} else if (args[0] === "--read" && args[1]) {
  const i = args.indexOf("--signer");
  const signer = i >= 0 ? args[i + 1] : "arrowhq.near";
  const raw = execFileSync(
    "npx",
    ["tsx", join(here, "..", "s1", "read-result.ts"), args[1], signer, "--network", "mainnet", "--no-callback",
      "--input", '{"mode":"echo"}', "--wasm-sha", init.wasm_hash],
    { encoding: "utf8" },
  );
  const r = JSON.parse(raw);
  const pass = r.out === "null" || r.out === null || r.out_parsed?.pm === null;
  console.log(JSON.stringify({ tx: r.tx, request_id: r.request_id, out: r.out, attestation_http: r.attestation?.http ?? null }));
  console.log(`B5: ${pass ? "PASS" : "FAIL"} (${pass ? "no secret reached the other caller" : "other caller read PROTECTED_MASTER"})`);
  process.exit(pass ? 0 : 1);
} else {
  console.error("usage: s3c-b5-negative.ts --prepare | --read <tx_hash> [--signer <account>]");
  process.exit(2);
}
