// npm run arrow -- list | eval | buy | status | decrypt | rehost | transfer   (run through npm: the package has no bin entry)
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { type Network, resolveNetwork } from "@arrow/sdk";
import { appendRun } from "../../scripts/src/lib/evidence.ts";
import { loadEnv } from "../../scripts/src/lib/env.ts";
import { confirmSpend } from "../../scripts/src/lib/confirm.ts";
import { mask } from "../../scripts/src/lib/log.ts";
import {
  buyCommand, CliError, type Ctx, decryptCommand, EXIT, evalCommand, formatDecrypt, formatEval, listCommand, rehostCommand, resultCommand, statusCommand, transferCommand,
} from "./commands.ts";
import { resolveActor } from "./keys.ts";
import { SettleTimeout } from "./settle.ts";
import { PaymentUnclear, realTransport, type RelayMode, type Transport } from "./transport.ts";
import { makeViews } from "./views.ts";

const OPTIONS = {
  network: { type: "string" }, json: { type: "boolean" }, relay: { type: "string" }, yes: { type: "boolean" }, help: { type: "boolean", short: "h" },
  account: { type: "string" }, "demo-key": { type: "boolean" },
  criteria: { type: "string" }, "my-list": { type: "string" }, "key-column": { type: "string" },
  title: { type: "string" }, desc: { type: "string" }, price: { type: "string" }, "eval-fee": { type: "string" }, "max-evals": { type: "string" },
  mode: { type: "string" }, "blob-url": { type: "string" }, "out-blob": { type: "string" }, "dry-run": { type: "boolean" },
  out: { type: "string" }, "record-demo": { type: "boolean" },
  listing: { type: "string" }, eval: { type: "string" }, purchase: { type: "string" }, from: { type: "string" }, to: { type: "string" }, amount: { type: "string" }, limit: { type: "string" },
} as const;

export const HELP = `arrow: inspect a dataset before you pay for it

usage: npm run arrow -- <command> [options]

commands
  list <file.csv|.jsonl> --title T --desc D --price 2.00 --eval-fee 0.25 --blob-url <https> [--max-evals 50] [--mode scored|verdict] [--out-blob P] [--dry-run]
        encrypt locally and list. Run once with --dry-run to get the ciphertext, upload it, rerun with --blob-url.
  eval <listing_id> --criteria <file.json> [--my-list <file.csv> --key-column <name>] [--demo-key]
        pay the eval fee; prints a capped verdict (PASS/BUY, optionally fit and novelty)
  result <eval_id> [--demo-key]                     read the verdict of an eval you already paid (after exit 3)
  buy <listing_id> [--demo-key] [--out <path>]      pay the price, receive the key, decrypt, check the hashes
  rehost <listing_id> --blob-url <https>             seller only: point a listing at a new copy of the same file (1 base unit, returned)
  status [--listing <id> | --eval <id> | --purchase <id>] [--limit N]   listings, or one record
  decrypt <purchase_id> [--demo-key] [--out <path>] decrypt a purchase you already made (default: ~/.config/arrow/purchases, mode 0600)
  transfer --to buyer|seller --amount <usdc> [--from buyer|seller]      move USDC between the team wallets (mainnet only)

options
  --network testnet|mainnet   default: ARROW_NETWORK, else testnet
  --json                      machine-readable output
  --relay hosted|direct       mainnet only: how the signed intent reaches intents.near (default hosted)
  --yes                       skip the y/N prompt (a human step on mainnet)
  --account <id>              testnet NEAR account to pay from

exit codes: 0 ok · 1 error · 2 usage · 3 still pending (use status) · 4 refunded · 5 needs a terminal or --yes · 6 leak budget exhausted
`;

type Flags = ReturnType<typeof parse>["values"];
const parse = (argv: string[]) => parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });

function mockTransport(): Transport {
  const refuse = async () => {
    throw new Error("payment attempted in ARROW_TEST_MOCK_RPC mode");
  };
  return { pay: refuse, transfer: refuse };
}

export function buildCtx(f: Flags, env: Record<string, string | undefined> = process.env): Ctx {
  const network = (f.network ?? env.ARROW_NETWORK ?? "testnet") as Network;
  if (network !== "testnet" && network !== "mainnet") throw new CliError(`--network must be testnet or mainnet, got "${network}"`, EXIT.usage);
  const relay = (f.relay ?? "hosted") as RelayMode;
  if (relay !== "hosted" && relay !== "direct") throw new CliError("--relay must be hosted or direct", EXIT.usage);
  return {
    network,
    contract: resolveNetwork(network, env).contract,
    views: makeViews(network, env),
    transport: env.ARROW_TEST_MOCK_RPC ? mockTransport() : realTransport({ network, relay, env }),
    // TN-3: the commands always pass an `account` key (often undefined), which must not hide --account.
    actor: (role, flags) => resolveActor(network, role, { ...flags, account: flags?.account ?? f.account }),
    confirm: async (plan) => {
      if (network === "mainnet") await confirmSpend(plan, f.yes === true);
    },
    evidence: (run) => appendRun(network, { ...run, script: "agent/src/cli.ts" }),
    progress: f.json ? undefined : (line) => console.error(mask(line)),
  };
}

const int = (v: string | undefined, what: string): number => {
  if (v === undefined || !/^\d+$/.test(v)) throw new CliError(`${what} must be a number`, EXIT.usage);
  return Number(v);
};
const need = (v: string | undefined, flag: string): string => {
  if (v === undefined) throw new CliError(`missing ${flag}`, EXIT.usage);
  return v;
};

export async function main(argv: string[], deps: { ctx?: (f: Flags) => Ctx; out?: (s: string) => void } = {}): Promise<number> {
  const out = deps.out ?? ((s: string) => console.log(mask(s)));
  let parsed;
  try {
    parsed = parse(argv);
  } catch (e) {
    console.error(`${(e as Error).message}\n\n${HELP}`);
    return EXIT.usage;
  }
  const { values: f, positionals } = parsed;
  const [command, arg] = positionals;
  if (f.help || !command || command === "help") {
    out(HELP);
    return command || f.help ? EXIT.ok : EXIT.usage;
  }
  const emit = (json: unknown, lines: string[]) => out(f.json ? JSON.stringify(json) : lines.join("\n"));

  try {
    const ctx = (deps.ctx ?? buildCtx)(f);
    const demoKey = f["demo-key"];
    switch (command) {
      case "eval": {
        const r = await evalCommand(ctx, { listingId: int(arg, "listing_id"), criteria: need(f.criteria, "--criteria"), myList: f["my-list"], keyColumn: f["key-column"], demoKey });
        emit(r, [formatEval(r)]);
        return r.status === "refunded" ? EXIT.refunded : EXIT.ok;
      }
      case "result": {
        const r = await resultCommand(ctx, { evalId: int(arg, "eval_id"), demoKey });
        if (r.status === "pending") {
          emit(r, [`eval #${r.eval_id} is still pending: try again in a minute`]);
          return EXIT.pending;
        }
        emit(r, [formatEval(r)]);
        return r.status === "refunded" ? EXIT.refunded : EXIT.ok;
      }
      case "buy": {
        if (f["record-demo"] && !demoKey) throw new CliError("--record-demo needs --demo-key", EXIT.usage);
        const r = await buyCommand(ctx, { listingId: int(arg, "listing_id"), demoKey, out: f.out, recordDemo: f["record-demo"] });
        emit(r, r.status === "refunded" ? [`REFUNDED (${r.refund_reason}) · price returned to your ${ctx.network === "mainnet" ? "NEAR Intents" : "arrow-usd"} balance · tx ${r.tx_url}`] : [`bought listing #${r.listing_id} · purchase #${r.purchase_id} · tx ${r.tx_url}`, ...formatDecrypt(r.decrypt!)]);
        return r.status === "refunded" ? EXIT.refunded : r.decrypt!.ok ? EXIT.ok : EXIT.error;
      }
      case "decrypt": {
        const r = await decryptCommand(ctx, { purchaseId: int(arg, "purchase_id"), demoKey, out: f.out });
        emit(r, formatDecrypt(r));
        return r.ok ? EXIT.ok : EXIT.error;
      }
      case "list": {
        const r = await listCommand(ctx, {
          file: need(arg, "<file>"), title: need(f.title, "--title"), desc: need(f.desc, "--desc"), price: need(f.price, "--price"), evalFee: need(f["eval-fee"], "--eval-fee"),
          maxEvals: f["max-evals"] ? int(f["max-evals"], "--max-evals") : undefined, mode: f.mode as "scored" | "verdict" | undefined,
          blobUrl: f["blob-url"], outBlob: f["out-blob"], dryRun: f["dry-run"],
        });
        emit(r, r.dry_run
          ? [JSON.stringify(r.msg_masked, null, 2), `ciphertext written: ${r.blob_path} (sha256 ${r.blob_sha256})`, "dry run: nothing sent"]
          : [`listed #${r.listing_id} · sha256 ${r.blob_sha256} · tx ${r.tx_url}`]);
        return EXIT.ok;
      }
      case "rehost": {
        const r = await rehostCommand(ctx, { listingId: int(arg, "listing_id"), blobUrl: need(f["blob-url"], "--blob-url") });
        emit(r, [`rehosted #${r.listing_id} · ${r.blob_url} · tx ${r.tx_url}`]);
        return EXIT.ok;
      }
      case "status": {
        const r = await statusCommand(ctx, {
          listing: f.listing ? int(f.listing, "--listing") : undefined, eval: f.eval ? int(f.eval, "--eval") : undefined,
          purchase: f.purchase ? int(f.purchase, "--purchase") : undefined, limit: f.limit ? int(f.limit, "--limit") : undefined,
        });
        emit(r, formatStatus(r));
        return EXIT.ok;
      }
      case "transfer": {
        const r = await transferCommand(ctx, { to: need(f.to, "--to") as "buyer" | "seller", from: f.from as "buyer" | "seller" | undefined, amount: need(f.amount, "--amount") });
        emit(r, [`transferred ${r.amount} USDC ${r.from} → ${r.to} · tx ${r.tx_url}`]);
        return EXIT.ok;
      }
      default:
        console.error(`unknown command "${command}"\n\n${HELP}`);
        return EXIT.usage;
    }
  } catch (e) {
    if (e instanceof SettleTimeout || e instanceof PaymentUnclear) {
      console.error(mask(e.message));
      return EXIT.pending;
    }
    console.error(mask(e instanceof Error ? e.message : String(e)));
    return e instanceof CliError ? e.exit : EXIT.error;
  }
}

function formatStatus(r: unknown): string[] {
  if (!Array.isArray(r)) return [JSON.stringify(r, null, 2)];
  if (r.length === 0) return ["no listings"];
  return r.map((l: any) => `#${l.id} · ${l.title} · price ${l.price_usdc} · eval ${l.eval_fee_usdc} · evals ${l.evals_used}/${l.max_evals} · budget left ${l.budget_left_bits} bits`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadEnv();
  process.exit(await main(process.argv.slice(2)));
}
