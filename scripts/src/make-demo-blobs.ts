// WS6-T01: encrypts a demo dataset for one network, at listing time. The plain K is NOT stored anywhere: it is
// sealed to the program key (sealed_k) and dropped from memory (PLAN WS6-T01, card section 0.4).
//   npx tsx scripts/src/make-demo-blobs.ts --dataset unlock|labels|team-made --network testnet|mainnet [--program-pubkey <130 hex>]
//   npx tsx scripts/src/make-demo-blobs.ts --emit-msg --draft <draft.json> --blob-base <https prefix>
//   npx tsx scripts/src/make-demo-blobs.ts --check
// A blob is encrypted with a fresh K every run, so a new run makes a new blob; sealed_k only opens with the
// program key of that network, which changes after the freeze re-init (old testnet listings then refund).
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ArrowViews, b64, encryptFile, ListMsg, type Network, seal, sealedKPayload } from "@arrow/sdk";
import { parseCsv } from "../../bench/src/gen/csv.ts";

export type DemoDataset = "unlock" | "labels" | "team-made";

type Spec = { file: string; title: string; public_desc: string; price: string; eval_fee: string };
// Prices: DEC K-06 (demo 2.00 / 0.25 USDC, team-made 1.00 / 0.10 USDC; 6 decimals).
export const SPECS: Record<DemoDataset, Spec> = {
  unlock: {
    file: "fixtures/demo/unlock-schedule-412.csv",
    title: "[synthetic] Q1 2027 token unlock schedule (412 rows)",
    public_desc: "Fictional token unlock schedule for Q1 2027: dates, amounts and share of supply per unlock. Synthetic demo data made by the Arrow team; the seller is the team.",
    price: "2000000",
    eval_fee: "250000",
  },
  labels: {
    file: "fixtures/demo/wallet-labels-1000.csv",
    title: "[synthetic] NEAR DeFi wallet labels (1,000 rows)",
    public_desc: "Fictional labels for 1,000 NEAR DeFi wallets (bots, LPs, exchange wallets) with confidence scores, active Aug-Oct 2026. Synthetic demo data made by the Arrow team; the seller is the team.",
    price: "2000000",
    eval_fee: "250000",
  },
  "team-made": {
    file: "fixtures/team-made/near-chain-stats-2026-11.csv",
    title: "[team-made] NEAR mainnet chain stats, Nov 2026 (computed from public RPC)",
    public_desc: "Per-block NEAR mainnet statistics (gas used and limit, utilization, transactions and receipts across all shards), sampled every 600 blocks over about 48 hours. Computed by the Arrow team from public RPC. Real data, not synthetic.",
    price: "1000000",
    eval_fee: "100000",
  },
};

export interface DemoDraft {
  v: 1;
  dataset: DemoDataset;
  network: Network;
  program_pubkey: string;
  title: string;
  public_desc: string;
  columns: string[];
  rows_claimed: number;
  blob_sha256: string;
  blob_bytes: number;
  sealed_k: string;
  price: string;
  eval_fee: string;
  max_evals: number;
  mode: "scored";
  created_at_utc: string;
}

export interface PrepareOpts {
  dataset: DemoDataset;
  network: Network;
  /** 130 lowercase hex starting with 04. Read from the contract when absent. */
  programPubkey?: string;
  /** Repository root; tests point it at a temp dir. */
  root?: string;
  /** Tests only: a fixed K, so the test can search for it. */
  key?: Uint8Array;
  now?: Date;
}

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export async function prepareDemoListing(o: PrepareOpts): Promise<DemoDraft> {
  const root = o.root ?? defaultRoot;
  const spec = SPECS[o.dataset];
  const plain = readFileSync(resolve(defaultRoot, spec.file)); // the plaintext always comes from the real repo
  const { header, rows } = parseCsv(plain.toString("utf8"));

  let pk = o.programPubkey ?? null;
  if (pk === null) pk = await new ArrowViews(o.network).programPubkey();
  if (pk === null) throw new Error(`${o.network}: the contract has no program key yet (init not done)`);

  const enc = encryptFile(new Uint8Array(plain), o.key);
  const sealedK = b64.enc(seal(pk, sealedKPayload(enc.key, enc.blobSha256)));
  const draft: DemoDraft = {
    v: 1,
    dataset: o.dataset,
    network: o.network,
    program_pubkey: pk,
    title: spec.title,
    public_desc: spec.public_desc,
    columns: header,
    rows_claimed: rows.length,
    blob_sha256: enc.blobSha256,
    blob_bytes: enc.blob.length,
    sealed_k: sealedK,
    price: spec.price,
    eval_fee: spec.eval_fee,
    max_evals: 50,
    mode: "scored",
    created_at_utc: (o.now ?? new Date()).toISOString().slice(0, 19) + "Z",
  };
  for (const dir of ["fixtures/blobs", "web/public/blobs"]) {
    mkdirSync(resolve(root, dir), { recursive: true });
    writeFileSync(resolve(root, dir, `${enc.blobSha256}.bin`), enc.blob);
  }
  const draftDir = resolve(root, "fixtures/demo/listings", o.network);
  mkdirSync(draftDir, { recursive: true });
  writeFileSync(resolve(draftDir, `${o.dataset}-${enc.blobSha256.slice(0, 8)}.json`), JSON.stringify(draft, null, 2) + "\n");
  enc.key.fill(0); // K leaves memory here; only sealed_k (to the program key) remains
  return draft;
}

/** The `list` msg for a draft once the blob is reachable at `<blobBase>/<sha>.bin`. Validated with the SDK schema. */
export function listMsg(d: DemoDraft, blobBase: string): ListMsg {
  return ListMsg.parse({
    op: "list",
    title: d.title,
    public_desc: d.public_desc,
    columns: d.columns,
    rows_claimed: d.rows_claimed,
    blob_url: `${blobBase.replace(/\/+$/, "")}/${d.blob_sha256}.bin`,
    blob_sha256: d.blob_sha256,
    sealed_k: d.sealed_k,
    price: d.price,
    eval_fee: d.eval_fee,
    max_evals: d.max_evals,
    mode: d.mode,
  });
}

/** sha256(file) == file name for every blob, and the web/public copy is byte-identical. */
export function checkBlobs(root = defaultRoot): { total: number; problems: string[] } {
  const dir = resolve(root, "fixtures/blobs");
  const problems: string[] = [];
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".bin")) : [];
  for (const n of names) {
    const body = readFileSync(resolve(dir, n));
    if (createHash("sha256").update(body).digest("hex") !== n.slice(0, -4)) problems.push(`${n}: sha256 != file name`);
    const copy = resolve(root, "web/public/blobs", n);
    if (!existsSync(copy) || !readFileSync(copy).equals(body)) problems.push(`${n}: web/public/blobs copy missing or different`);
  }
  return { total: names.length, problems };
}

async function main() {
  const args = process.argv.slice(2);
  const val = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  if (args.includes("--check")) {
    const r = checkBlobs();
    for (const p of r.problems) console.error(`PROBLEM ${p}`);
    if (r.problems.length === 0) console.log(`blobs: ${r.total}/${r.total} sha256 == filename, web/public copies identical`);
    process.exit(r.problems.length === 0 ? 0 : 1);
  }
  if (args.includes("--emit-msg")) {
    const draftFile = val("--draft"), base = val("--blob-base");
    if (!draftFile || !base) throw new Error("--emit-msg needs --draft <file> and --blob-base <https prefix>");
    const msg = listMsg(JSON.parse(readFileSync(resolve(draftFile), "utf8")) as DemoDraft, base);
    console.log(JSON.stringify(msg));
    console.error(`blob_url length ${msg.blob_url.length}/200`);
    return;
  }
  const dataset = val("--dataset") as DemoDataset | undefined;
  const network = val("--network") as Network | undefined;
  if (!dataset || !(dataset in SPECS) || (network !== "testnet" && network !== "mainnet")) {
    throw new Error("usage: --dataset unlock|labels|team-made --network testnet|mainnet");
  }
  const d = await prepareDemoListing({ dataset, network, programPubkey: val("--program-pubkey") });
  console.log(`program_pubkey ${d.program_pubkey.slice(0, 6)}... (${d.program_pubkey.length} hex)`);
  console.log(`wrote fixtures/blobs/${d.blob_sha256}.bin + web/public/blobs/${d.blob_sha256}.bin (${d.blob_bytes} bytes)`);
  console.log(`draft fixtures/demo/listings/${network}/${dataset}-${d.blob_sha256.slice(0, 8)}.json`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
