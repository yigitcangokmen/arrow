// WS6-T01: deterministic generator for the SYNTHETIC demo datasets, the two buyer lists and expected.json.
//   npx tsx scripts/src/gen-demo-data.ts [--check]
// Everything here is fictional. Accounts live under synthetic-demo.near. Do not run a formatter over fixtures/.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { signature } from "@arrow/sdk";
import { toCsv } from "../../bench/src/gen/csv.ts";
import { rngFor, type Rng } from "../../bench/src/gen/prng.ts";
import { counts, estimateByHits, estimateJaccardTimesSize, exactContainment, noveltyBand } from "./lib/containment.ts";

export const DEMO_DIR = "fixtures/demo";
export const UNLOCK_ROWS = 412, UNLOCK_OVERLAP = 371;
export const LABELS_ROWS = 1000, LABELS_OVERLAP = 300;

export const UNLOCK_HEADER = ["unlock_id", "token_symbol", "token_contract", "chain", "unlock_date", "unlock_amount", "pct_of_supply", "category", "cliff", "source_note", "synthetic"] as const;
export const LABELS_HEADER = ["account_id", "label", "confidence", "first_seen", "last_active", "tx_count_90d", "top_protocol", "evidence", "synthetic"] as const;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const hex6 = (r: Rng) => r.int(0x1000000).toString(16).padStart(6, "0");
function addDays(base: string, n: number): string {
  const [y, m, d] = base.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const weighted = <T>(r: Rng, xs: readonly (readonly [T, number])[]): T => {
  let u = r.int(100);
  for (const [v, w] of xs) { if (u < w) return v; u -= w; }
  return xs[xs.length - 1]![0];
};

const CHAINS = [["near", 50], ["base", 20], ["solana", 15], ["arbitrum", 10], ["ethereum", 5]] as const;
const CATEGORIES = ["team", "investors", "ecosystem", "treasury", "advisors"] as const;
const NOTES = [
  () => "vesting schedule v2",
  () => "foundation blog post (fictional)",
  () => "token terms PDF (fictional)",
  (r: Rng) => `governance proposal #${1 + r.int(240)} (fictional)`,
] as const;
const LABEL_SET = ["lp_whale", "arbitrage_bot", "cex_hot_wallet", "airdrop_farmer", "dao_treasury", "bridge_user", "validator_operator", "nft_trader"] as const;
const PROTOCOLS = ["dex", "lending", "liquid_staking", "bridge", "nft_market", "intents", "other"] as const;
const EVIDENCE: Record<(typeof LABEL_SET)[number], readonly string[]> = {
  lp_whale: ["repeated LP adds over 30d", "large single-sided liquidity deposits"],
  arbitrage_bot: ["sub-second arbitrage pattern", "same-block round trips across two pools"],
  cex_hot_wallet: ["deposit sweeps to one hot wallet", "fixed-size withdrawals at regular intervals"],
  airdrop_farmer: ["many small claims from linked wallets", "minimal activity before each snapshot"],
  dao_treasury: ["multisig-style outgoing payments", "periodic grants to many recipients"],
  bridge_user: ["frequent in/out transfers via bridges", "round-number cross-chain deposits"],
  validator_operator: ["stake and unstake on a fixed cycle", "reward claims every epoch"],
  nft_trader: ["bursts of mints followed by sales", "floor-price sweeps on collections"],
};

function unlockRows(seed: string): string[][] {
  const r = rngFor(seed);
  const rows: string[][] = [];
  const used = new Set<string>();
  for (let i = 0; i < UNLOCK_ROWS; i++) {
    let sym: string;
    do sym = "X" + Array.from({ length: 3 }, () => String.fromCharCode(65 + r.int(26))).join("");
    while (used.has(sym) && used.size < 17000);
    used.add(sym);
    const u = r.next(), v = r.next(), w = r.next(), z = r.next();
    rows.push([
      `U27-${pad(i + 1, 4)}`,
      sym,
      `t${pad(i + 1, 4)}-${hex6(r)}.synthetic-demo.near`,
      weighted(r, CHAINS),
      addDays("2027-01-01", Math.floor((i * 89) / (UNLOCK_ROWS - 1))),
      String(10_000 + Math.floor(u * v * w * 49_990_000)),
      (0.1 + 11.9 * z * z).toFixed(2),
      r.pick(CATEGORIES),
      r.int(2) === 0 ? "true" : "false",
      r.pick(NOTES)(r),
      "yes",
    ]);
  }
  return rows;
}

function labelRows(seed: string): string[][] {
  const r = rngFor(seed);
  const firstSpan = daysBetween("2024-01-01", "2026-07-31");
  const rows: string[][] = [];
  for (let i = 0; i < LABELS_ROWS; i++) {
    const label = r.pick(LABEL_SET);
    const u = r.next(), v = r.next();
    rows.push([
      `w${pad(i + 1, 4)}-${hex6(r)}.synthetic-demo.near`,
      label,
      (0.5 + 0.49 * u).toFixed(2),
      addDays("2024-01-01", r.int(firstSpan + 1)),
      addDays("2026-08-01", Math.floor((i * 91) / (LABELS_ROWS - 1))),
      String(1 + Math.floor(v * v * 4999)),
      r.pick(PROTOCOLS),
      r.pick(EVIDENCE[label]),
      "yes",
    ]);
  }
  return rows;
}

/** Buyer list: `overlap` keys taken from the seller column, the rest fresh synthetic names; shuffled. */
function buyerList(seed: string, sellerKeys: string[], total: number, overlap: number, prefix: string): string[] {
  const r = rngFor(seed);
  const own = r.shuffle([...sellerKeys]).slice(0, overlap);
  const fresh = Array.from({ length: total - overlap }, (_, i) => `${prefix}${pad(i + 1, 4)}-${hex6(r)}.synthetic-demo.near`);
  return r.shuffle([...own, ...fresh]);
}

type Built = { files: Map<string, string>; expected: unknown };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Smallest seed bump where the MinHash estimators sit inside the target band with margin (card WS6-T01 D). */
export function build(): Built {
  for (let bump = 0; bump < 200; bump++) {
    const tag = (n: string) => `demo/${n}/${bump}`;
    const uRows = unlockRows(tag("unlock")), lRows = labelRows(tag("labels"));
    const uKeys = uRows.map((x) => x[2]!), lKeys = lRows.map((x) => x[0]!);
    const uBuyer = buyerList(tag("buyer-unlock"), uKeys, UNLOCK_ROWS, UNLOCK_OVERLAP, "tb");
    const lBuyer = buyerList(tag("buyer-labels"), lKeys, LABELS_ROWS, LABELS_OVERLAP, "wb");
    const est = (a: string[], b: string[]) => {
      const n = counts(a, signature(b));
      return { exact_seller_in_buyer: exactContainment(a, b), exact_buyer_in_seller: exactContainment(b, a), by_hits: estimateByHits(n), jaccard_times_size: estimateJaccardTimesSize(n), band: noveltyBand(n), j: n.j, c: n.c };
    };
    const u = est(uKeys, uBuyer), l = est(lKeys, lBuyer);
    const uOk = u.by_hits >= 0.85 && u.jaccard_times_size >= 0.85 && u.band === 1;
    const lOk = [l.by_hits, l.jaccard_times_size].every((x) => x >= 0.25 && x <= 0.35) && l.band === 4;
    if (!uOk || !lOk) continue;

    const files = new Map<string, string>([
      [`${DEMO_DIR}/unlock-schedule-412.csv`, toCsv(UNLOCK_HEADER, uRows)],
      [`${DEMO_DIR}/wallet-labels-1000.csv`, toCsv(LABELS_HEADER, lRows)],
      [`${DEMO_DIR}/buyer-list-unlock.csv`, toCsv(["token_contract"], uBuyer.map((x) => [x]))],
      [`${DEMO_DIR}/buyer-list-labels.csv`, toCsv(["account_id"], lBuyer.map((x) => [x]))],
    ]);
    const round = (x: number) => Math.round(x * 1000) / 1000;
    const expected = {
      v: 1,
      synthetic: true,
      note: "Fictional data made by the Arrow team for the demo. Bands are the arrow-core novelty() result; demo_bands.rs is the proof.",
      unlock: {
        rows: UNLOCK_ROWS, overlap: UNLOCK_OVERLAP,
        containment_seller_in_buyer: round(u.exact_seller_in_buyer), containment_buyer_in_seller: round(u.exact_buyer_in_seller),
        minhash: { by_hits: round(u.by_hits), jaccard_times_size: round(u.jaccard_times_size), j: u.j, c: u.c },
        band: 1, fit_rule: 4, expected: "PASS · fit ≤4 · novelty 1",
      },
      labels: {
        rows: LABELS_ROWS, overlap: LABELS_OVERLAP,
        containment_seller_in_buyer: round(l.exact_seller_in_buyer), containment_buyer_in_seller: round(l.exact_buyer_in_seller),
        minhash: { by_hits: round(l.by_hits), jaccard_times_size: round(l.jaccard_times_size), j: l.j, c: l.c },
        band: 4, fit_rule: 5, expected: "BUY · fit ≥4 · novelty 4 (LLM-dependent)",
      },
      print_row_1: { expected: "PASS · fit 1 · novelty 1" },
      plaintext_sha256: Object.fromEntries([...files].map(([p, c]) => [p.split("/").pop(), sha(c)])),
      seeds: { bump, unlock: tag("unlock"), labels: tag("labels"), buyer_unlock: tag("buyer-unlock"), buyer_labels: tag("buyer-labels"), prng: "sfc32, seed = sha256('arrow/bench/v1/' + name)[0..16]" },
    };
    files.set(`${DEMO_DIR}/expected.json`, JSON.stringify(expected, null, 2) + "\n");
    return { files, expected };
  }
  throw new Error("no seed bump in 0..199 puts both datasets inside their bands");
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const { files } = build();
  if (process.argv.includes("--check")) {
    let same = 0;
    for (const [p, c] of files) {
      let disk = "";
      try { disk = readFileSync(resolve(root, p), "utf8"); } catch { /* missing */ }
      if (disk === c) same++;
      else console.error(`DIFF ${p}`);
    }
    console.log(`demo data: ${same}/${files.size} files byte-identical`);
    process.exit(same === files.size ? 0 : 1);
  }
  mkdirSync(resolve(root, DEMO_DIR), { recursive: true });
  for (const [p, c] of files) {
    writeFileSync(resolve(root, p), c, "utf8");
    console.log(`wrote ${p}${p.endsWith(".csv") ? ` (${c.split("\n").length - 2} rows)` : ""}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
