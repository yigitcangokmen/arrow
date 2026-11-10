// npm run verify -- [--network testnet|mainnet] [--pre-lock] [--only <kind>] [--decrypt-demo] [--json]
//                   [--evidence <path>] [--unlocked-reason "<text>"]          (WS4-T13, DEC O-01..O-07)
// Reads evidence/<network>.json, the contract's views, the archival RPC, OutLayer's attestation API and 1Click.
// Prints PROVEN / NOT PROVEN / RISKY rows and ends with `verify: <n>/<N> REQUIRED PROVEN · exit <0|1>`. Writes nothing
// except ./out/demo-<id>.csv with --decrypt-demo.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { type Network } from "@arrow/sdk";
import { EvidenceFile } from "@arrow/sdk/schemas";
import { decryptDemo, formatReport, ONLY_KINDS, type OnlyKind, runVerify, type TeamAccounts, type VerifyOptions } from "@arrow/sdk/verify";
import { loadEnv, mainCheckout, repoRoot } from "./lib/env.ts";
import { evidenceDir, readEvidence } from "./lib/evidence.ts";
import { log, mask } from "./lib/log.ts";

export const HELP = `usage: npm run verify -- [options]

  --network testnet|mainnet   default: mainnet
  --pre-lock                  before the lock: R6 pending, listings count as pre-lock (mainnet)
  --only <kind>[,<kind>]      ${ONLY_KINDS.join(" | ")}
  --decrypt-demo              open the demo purchase with the public demo viewing key
  --json                      print the report as JSON
  --evidence <path>           evidence file (default: evidence/<network>.json in the main checkout)
  --unlocked-reason "<text>"  the contract could not be locked: R6 and R7 become RISKY and leave the REQUIRED count

exit codes: 0 all REQUIRED rows PROVEN · 1 otherwise or on an error
`;

function readOptional(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

export async function main(argv: string[], io: { out: (line: string) => void; err: (line: string) => void } = { out: log, err: (l) => console.error(mask(l)) }): Promise<number> {
  let values;
  try {
    values = parseArgs({
      args: argv,
      strict: true,
      options: {
        network: { type: "string", default: "mainnet" }, "pre-lock": { type: "boolean" }, only: { type: "string", multiple: true },
        "decrypt-demo": { type: "boolean" }, json: { type: "boolean" }, evidence: { type: "string" }, "unlocked-reason": { type: "string" }, help: { type: "boolean", short: "h" },
      },
    }).values;
  } catch (e) {
    io.err(`${(e as Error).message}\n\n${HELP}`);
    return 2;
  }
  if (values.help) {
    io.out(HELP);
    return 0;
  }
  if (values.network !== "testnet" && values.network !== "mainnet") {
    io.err(`--network must be testnet or mainnet, got "${values.network}"`);
    return 2;
  }
  const network = values.network as Network;
  const only = (values.only ?? []).flatMap((s) => s.split(",")).filter(Boolean);
  const unknown = only.filter((k) => !(ONLY_KINDS as readonly string[]).includes(k));
  if (unknown.length) {
    io.err(`unknown --only kind "${unknown[0]}" (use ${ONLY_KINDS.join(", ")})`);
    return 2;
  }
  if (values["unlocked-reason"] !== undefined && values["unlocked-reason"].trim() === "") {
    io.err("--unlocked-reason needs a reason");
    return 2;
  }

  try {
    const evidence = values.evidence ? EvidenceFile.parse(JSON.parse(readFileSync(resolve(values.evidence), "utf8"))) : readEvidence(network);
    const release = readOptional(resolve(repoRoot(), "release/sha256.txt")) ?? readOptional(resolve(mainCheckout(), "release/sha256.txt"));
    const teamRaw = readOptional(resolve(evidenceDir(), "team-accounts.json"));
    const opts: VerifyOptions = {
      network,
      evidence,
      releaseSha256: release?.trim().split(/\s+/)[0],
      preLock: values["pre-lock"] === true,
      unlockedReason: values["unlocked-reason"],
      only: only as OnlyKind[],
      teamAccounts: teamRaw ? (JSON.parse(teamRaw) as TeamAccounts) : undefined,
      contract: process.env[`ARROW_CONTRACT_${network.toUpperCase()}`] || undefined,
    };

    if (values["decrypt-demo"]) {
      const d = await decryptDemo(opts);
      const path = resolve("out", d.fileName);
      mkdirSync(resolve("out"), { recursive: true });
      writeFileSync(path, d.plaintext);
      for (const line of d.lines(`./out/${d.fileName}`)) io.out(line);
      return 0;
    }

    const report = await runVerify(opts);
    if (values.json) io.out(JSON.stringify(report, null, 2));
    else for (const line of formatReport(report)) io.out(line);
    return report.exitCode;
  } catch (e) {
    io.err(`verify failed: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadEnv();
  process.exit(await main(process.argv.slice(2)));
}
