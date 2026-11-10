// TN-4: a FastFS upload can print "Upload complete!" for a chunk tx that never landed, and an upload with every chunk FINAL can stay 404
// for an hour. Before a deploy points at the URL: every chunk tx must be FINAL and successful, and the URL must serve the sha.
//   npx tsx scripts/src/fastfs-check.ts --network testnet|mainnet --url <fastfs url> --sha <sha256> --tx <hash>[,<hash>...] [--wait <minutes>] [--sender <account>]
// Read-only. Exit 0 when the upload is good, 1 when not (upload again), 2 on bad usage.
import "./lib/require-node.ts";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { fetchAndCheckBlob, type Network, txStatus } from "@arrow/sdk";
import { log } from "./lib/log.ts";

export interface FastfsDeps {
  /** ok only when the tx reached FINAL and its outcome is a success */
  txFinal(txHash: string, sender: string): Promise<{ ok: boolean; why: string }>;
  served(url: string, sha: string): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  now(): number;
  say(line: string): void;
}

export interface FastfsOpts {
  url: string;
  sha: string;
  txs: string[];
  sender: string;
  waitMinutes: number;
}

const POLL_MS = 30_000;

/** The account that signed the upload is the first path segment of a FastFS URL: https://<host>/<account>/<receiver>/<file>. */
export const senderOf = (url: string): string | undefined => new URL(url).pathname.split("/").filter(Boolean)[0];

export async function checkUpload(d: FastfsDeps, o: FastfsOpts): Promise<{ ok: boolean; problems: string[] }> {
  const problems: string[] = [];
  if (o.txs.length === 0) problems.push("no chunk tx given: pass every tx hash the upload printed (--tx a,b)");
  for (const tx of o.txs) {
    const r = await d.txFinal(tx, o.sender);
    d.say(`${r.ok ? "PASS" : "FAIL"} chunk tx ${tx}: ${r.why}`);
    if (!r.ok) problems.push(`chunk tx ${tx} is not a FINAL success (${r.why})`);
  }
  const deadline = d.now() + o.waitMinutes * 60_000;
  let up = await d.served(o.url, o.sha);
  while (!up && d.now() < deadline) {
    d.say(`${o.url} does not serve ${o.sha.slice(0, 12)}… yet; checking again in ${POLL_MS / 1000} s`);
    await d.sleep(POLL_MS);
    up = await d.served(o.url, o.sha);
  }
  d.say(`${up ? "PASS" : "FAIL"} ${o.url} ${up ? "serves" : `does not serve (after ${o.waitMinutes} min)`} the sha256`);
  if (!up) problems.push(`${o.url} does not serve ${o.sha} within ${o.waitMinutes} minutes: upload the file again`);
  return { ok: problems.length === 0, problems };
}

/** One chunk tx from a FINAL txStatus. FastFS calls the receiver with 1 gas on purpose, so "Exceeded the prepaid gas" is the
 * expected outcome of a landed chunk (the indexer reads the arguments); any other failure, or no FINAL status, is not. */
export function chunkOutcome(s: any): { ok: boolean; why: string } {
  const failure = [s?.status, ...(s?.receipts_outcome ?? []).map((r: any) => r?.outcome?.status)].find((x) => x?.Failure)?.Failure;
  const fastfsGas = failure?.ActionError?.kind?.FunctionCallError?.ExecutionError === "Exceeded the prepaid gas.";
  if (failure && !fastfsGas) return { ok: false, why: `failed: ${JSON.stringify(failure).slice(0, 120)}` };
  if (s?.final_execution_status !== "FINAL") return { ok: false, why: `status ${s?.final_execution_status ?? "unknown"}` };
  return { ok: true, why: fastfsGas ? "FINAL, out of prepaid gas as FastFS intends" : "FINAL, success" };
}

async function main(argv: string[]): Promise<number> {
  const { values: v } = parseArgs({
    args: argv,
    options: { network: { type: "string" }, url: { type: "string" }, sha: { type: "string" }, tx: { type: "string" }, wait: { type: "string", default: "30" }, sender: { type: "string" } },
    strict: true,
  });
  const usage = (m: string) => (console.error(`${m}\nusage: npx tsx scripts/src/fastfs-check.ts --network testnet|mainnet --url <url> --sha <sha256> --tx <hash>[,<hash>...] [--wait <minutes>] [--sender <account>]`), 2);
  if (v.network !== "testnet" && v.network !== "mainnet") return usage("--network must be testnet or mainnet");
  const network: Network = v.network;
  if (!v.url || !/^[0-9a-f]{64}$/.test(v.sha ?? "")) return usage("--url and a lowercase 64-hex --sha are required");
  const sender = v.sender ?? senderOf(v.url);
  const wait = Number(v.wait);
  if (!sender || !Number.isFinite(wait) || wait < 0) return usage("--sender could not be read from the url, or --wait is not a number");
  const res = await checkUpload(
    {
      txFinal: async (tx, who) => {
        try {
          return chunkOutcome(await txStatus(network, tx, who, "FINAL"));
        } catch (e) {
          return { ok: false, why: (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 120) };
        }
      },
      served: async (url, sha) => fetchAndCheckBlob(url, sha).then(() => true, () => false),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: Date.now,
      say: log,
    },
    { url: v.url, sha: v.sha!, txs: (v.tx ?? "").split(",").map((t) => t.trim()).filter(Boolean), sender, waitMinutes: wait },
  );
  if (!res.ok) console.error(res.problems.join("\n"));
  return res.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main(process.argv.slice(2)));
