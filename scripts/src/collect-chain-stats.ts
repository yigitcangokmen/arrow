// WS6-T02 (source B, DEC K KU-10): the team-made dataset is NEAR mainnet chain statistics computed from public
// JSON-RPC. No third-party site data. Two RPC methods only: `block` and `chunk`.
//
//   npx tsx scripts/src/collect-chain-stats.ts [--rows 500] [--stride 600] [--head <height>] [--cache <file>]   # needs network; --cache resumes after a crash
//   npx tsx scripts/src/collect-chain-stats.ts --check                                         # no network
//
// One row per sampled block (head - k*stride). Per-block fields add up the chunks newly included in that block
// (height_included == block height), so a missed chunk is never counted twice.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const OUT_DIR = "fixtures/team-made";
export const CSV_NAME = "near-chain-stats-2026-11.csv";
export const TITLE = "[team-made] NEAR mainnet chain stats, Nov 2026 (computed from public RPC)";
export const PUBLIC_DESC =
  "Per-block NEAR mainnet statistics (gas used and limit, utilization, transactions and receipts across all shards), sampled every 600 blocks (about six minutes) over about 19 hours. Computed by the Arrow team from public RPC. Real data, not synthetic.";
export const COLUMNS = [
  "block_height", "block_date", "block_ts", "shards", "chunks_included",
  "gas_used", "gas_limit", "utilization_pct", "tx_count", "receipt_count",
] as const;
export const ENDPOINTS = ["https://rpc.mainnet.fastnear.com", "https://archival-rpc.mainnet.fastnear.com"] as const;
export const METHODS = ["block", "chunk"] as const; // the whole request budget: nothing else is ever called
export const PACE_MS = 900; // base gap between two request starts; measured 2026-11-10: the public endpoint answers HTTP 429 above ~1.5 req/s sustained, so the gap grows by half on a 429 and shrinks again after 10 good calls
export const MAX_GAP_MS = 3000;
export const CONCURRENCY = 4; // workers; the endpoints (lanes) pace themselves
export const SKIP_WALK = 10; // heights tried downward when a sampled height has no block (skipped slot)
export const RETRY_WAIT_MS = [3000, 10000, 30000, 60000];

// ---- pure part (unit-tested) ----------------------------------------------------------------------------------

const BlockView = z.object({
  header: z.object({ height: z.number().int(), hash: z.string(), timestamp_nanosec: z.string() }),
  chunks: z.array(z.object({
    chunk_hash: z.string(), shard_id: z.number().int(), height_included: z.number().int(),
    gas_used: z.number().int().nonnegative(), gas_limit: z.number().int().positive(),
  })),
});
const ChunkView = z.object({ transactions: z.array(z.unknown()), receipts: z.array(z.unknown()) });
export type Block = z.infer<typeof BlockView>;
export type Chunk = z.infer<typeof ChunkView>;
export type Row = Record<(typeof COLUMNS)[number], string>;

export const isoSeconds = (ns: string): string => new Date(Number(BigInt(ns) / 1_000_000n)).toISOString().slice(0, 19) + "Z";

/** Chunks newly included in this block, i.e. the ones whose `chunk` query must be made. */
export const newChunks = (b: Block) => b.chunks.filter((c) => c.height_included === b.header.height);

/** `chunks` are the `chunk` RPC results for newChunks(block), same order. */
export function aggregate(block: Block, chunks: Chunk[]): Row {
  const fresh = newChunks(block);
  if (fresh.length !== chunks.length) throw new Error(`block ${block.header.height}: ${fresh.length} new chunks, ${chunks.length} chunk results`);
  const used = fresh.reduce((s, c) => s + BigInt(c.gas_used), 0n);
  const limit = fresh.reduce((s, c) => s + BigInt(c.gas_limit), 0n);
  const ts = isoSeconds(block.header.timestamp_nanosec);
  return {
    block_height: String(block.header.height),
    block_date: ts.slice(0, 10),
    block_ts: ts,
    shards: String(block.chunks.length),
    chunks_included: String(fresh.length),
    gas_used: used.toString(),
    gas_limit: limit.toString(),
    utilization_pct: limit === 0n ? "0.00" : pct(used, limit),
    tx_count: String(chunks.reduce((s, c) => s + c.transactions.length, 0)),
    receipt_count: String(chunks.reduce((s, c) => s + c.receipts.length, 0)),
  };
}

/** floor(100 * used / limit) with two decimals, in integer arithmetic. */
export function pct(used: bigint, limit: bigint): string {
  const c = (used * 10000n) / limit;
  return `${c / 100n}.${String(c % 100n).padStart(2, "0")}`;
}

export const toCsv = (rows: Row[]): string =>
  [COLUMNS.join(","), ...rows.map((r) => COLUMNS.map((k) => r[k]).join(","))].join("\n") + "\n"; // cells never hold , " or newline

export const sampleHeights = (head: number, rows: number, stride: number): number[] =>
  Array.from({ length: rows }, (_, k) => head - k * stride);

export type Manifest = {
  v: 1;
  title: string;
  source: string;
  endpoints: string[];
  methods: string[];
  head: { height: number; hash: string; timestamp_utc: string };
  stride: number;
  rows: number;
  first: { height: number; ts_utc: string };
  last: { height: number; ts_utc: string };
  skipped_heights: number;
  requests: { total: number; block: number; chunk: number; retries: number; rate_limited: number; by_endpoint: Record<string, number> };
  collection: { started_utc: string; finished_utc: string };
  csv: { path: string; sha256: string; bytes: number };
};

export function renderSource(m: Manifest): string {
  const ep = Object.entries(m.requests.by_endpoint).map(([k, v]) => `  - ${k}: ${v} requests`).join("\n");
  return `# ${m.title}

Public description (listing \`public_desc\`, ${PUBLIC_DESC.length} characters): ${PUBLIC_DESC}

## What this is
Real NEAR mainnet statistics that the Arrow team computed itself from public JSON-RPC responses. The dataset is **team-made** and **not synthetic**. It contains no third-party site data, no account ids, no transaction hashes and no personal data. Every cell is a number or a UTC timestamp.

## Source
- Source: ${m.source}.
- Endpoints (both serve the same chain; each request goes to the less busy one, and the archival one also answers when the other has no such block):
${m.endpoints.map((e) => `  - ${e}`).join("\n")}
- RPC methods used: ${m.methods.map((x) => `\`${x}\``).join(", ")}. Nothing else is called.
- Requests made: ${m.requests.total} (${m.requests.block} \`block\`, ${m.requests.chunk} \`chunk\`; ${m.requests.retries} retries after ${m.requests.rate_limited} HTTP 429 answers).
${ep}
- Pacing: at least ${PACE_MS} ms between two request starts on the same endpoint (the gap grows by half after an HTTP 429, up to ${MAX_GAP_MS} ms, and shrinks again after 10 good calls), at most ${CONCURRENCY} in flight.

## Collection
- Collection started: ${m.collection.started_utc} (UTC).
- Collection finished: ${m.collection.finished_utc} (UTC).
- Head (final block when the run started): height ${m.head.height}, hash \`${m.head.hash}\`, block time ${m.head.timestamp_utc} (UTC).
- Sampling: the block at \`head - k * ${m.stride}\` for k = 0..${m.rows - 1} (${m.rows} rows). If a height has no block (skipped slot) the nearest earlier block is used (${m.skipped_heights} of ${m.rows} sampled heights needed that).
- Block heights ${m.first.height} (${m.first.ts_utc}) to ${m.last.height} (${m.last.ts_utc}).
- Reproduce: \`npx tsx scripts/src/collect-chain-stats.ts --head ${m.head.height} --rows ${m.rows} --stride ${m.stride}\`. Blocks are immutable on chain, so the same head gives the same rows; the first endpoint keeps only a few days, the archival one serves older heights.

## File
- \`${m.csv.path}\`: ${m.rows} rows, ${m.csv.bytes} bytes, sha256 \`${m.csv.sha256}\`.
- Columns: \`block_height\`, \`block_date\` (UTC, YYYY-MM-DD), \`block_ts\` (UTC), \`shards\` (chunk slots in the block), \`chunks_included\` (chunks newly included in this block), \`gas_used\` and \`gas_limit\` (gas units, summed over the newly included chunks), \`utilization_pct\` (floor of 100 * gas_used / gas_limit, two decimals), \`tx_count\` (transactions in those chunks), \`receipt_count\` (length of the \`receipts\` array that the \`chunk\` method returns for those chunks, taken as returned).
- Rows are sorted by ascending block height.

## Limits
- This is a sample of ${m.rows} blocks, not every block. Utilization and counts describe those blocks only.
- Nothing here is cleaned; whatever the chain returned is what is in the file.
- The request counts above are for the whole run, including blocks that were fetched and are not in the file (the run was stopped early because the public endpoints answer HTTP 429 above about 1.5 requests per second).

Machine-readable twin: \`manifest.json\`. \`npx tsx scripts/src/collect-chain-stats.ts --check\` verifies the CSV against it without network.
`;
}

export type CheckResult = { ok: boolean; problems: string[]; rows: number };

/** Offline consistency check of the committed dataset. `read` is injectable for tests. */
export function checkDataset(read: (rel: string) => string | null): CheckResult {
  const problems: string[] = [];
  const csv = read(`${OUT_DIR}/${CSV_NAME}`);
  const mText = read(`${OUT_DIR}/manifest.json`);
  const src = read(`${OUT_DIR}/SOURCE.md`);
  if (csv === null || mText === null || src === null) return { ok: false, problems: ["missing csv, manifest.json or SOURCE.md"], rows: 0 };
  const m = JSON.parse(mText) as Manifest;
  const lines = csv.split("\n");
  if (lines.pop() !== "") problems.push("csv must end with one LF");
  if (csv.includes("\r") || csv.charCodeAt(0) === 0xfeff) problems.push("csv has CR or BOM");
  if (lines[0] !== COLUMNS.join(",")) problems.push("csv header differs from the column list");
  const rows = lines.slice(1).map((l) => l.split(","));
  if (rows.length !== m.rows) problems.push(`rows ${rows.length} != manifest ${m.rows}`);
  const sha = createHash("sha256").update(csv).digest("hex");
  if (sha !== m.csv.sha256) problems.push("csv sha256 != manifest");
  if (Buffer.byteLength(csv) !== m.csv.bytes) problems.push("csv bytes != manifest");
  let prevH = -1, prevTs = "";
  rows.forEach((c, i) => {
    const at = `row ${i + 1}`;
    if (c.length !== COLUMNS.length) return void problems.push(`${at}: ${c.length} cells`);
    const [h, d, ts, shards, inc, used, lim, util, tx, rc] = c as [string, string, string, string, string, string, string, string, string, string];
    if (!/^\d+$/.test(h) || Number(h) <= prevH) problems.push(`${at}: block_height not strictly ascending`);
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(ts) || ts < prevTs) problems.push(`${at}: block_ts bad or not ascending`);
    if (d !== ts.slice(0, 10)) problems.push(`${at}: block_date != date of block_ts`);
    if (!/^\d+$/.test(shards) || !/^\d+$/.test(inc) || Number(inc) > Number(shards)) problems.push(`${at}: chunks_included > shards`);
    if (!/^\d+$/.test(used) || !/^\d+$/.test(lim) || BigInt(used) > BigInt(lim)) problems.push(`${at}: gas_used > gas_limit`);
    else if (BigInt(lim) > 0n && pct(BigInt(used), BigInt(lim)) !== util) problems.push(`${at}: utilization_pct inconsistent`);
    if (!/^\d+$/.test(tx) || !/^\d+$/.test(rc)) problems.push(`${at}: tx_count or receipt_count not an integer`);
    prevH = Number(h);
    prevTs = ts;
  });
  if (rows.length) {
    if (m.first.height !== Number(rows[0]![0]) || m.last.height !== Number(rows[rows.length - 1]![0])) problems.push("manifest first/last height != csv");
  }
  if (src !== renderSource(m)) problems.push("SOURCE.md is not the rendering of manifest.json");
  if (!/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ/.test(m.collection.started_utc)) problems.push("manifest has no UTC collection time");
  if (m.methods.join() !== METHODS.join()) problems.push("manifest methods differ from the request budget");
  if (/[@]|https?:/i.test(csv)) problems.push("csv contains @ or a URL");
  return { ok: problems.length === 0, problems, rows: rows.length };
}

// ---- network part ----------------------------------------------------------------------------------------------

export class RpcFailure extends Error {
  constructor(message: string, readonly causeName: string | null, readonly retryable: boolean) {
    super(message);
  }
}
const MISSING = new Set(["UNKNOWN_BLOCK", "UNKNOWN_CHUNK", "GARBAGE_COLLECTED_BLOCK", "NOT_SYNCED_YET"]);

export type ClientOpts = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  endpoints?: readonly string[];
  paceMs?: number;
  retryWaits?: number[];
};

export function makeClient(o: ClientOpts = {}) {
  const f = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const endpoints = o.endpoints ?? ENDPOINTS;
  const paceMs = o.paceMs ?? PACE_MS;
  const waits = o.retryWaits ?? RETRY_WAIT_MS;
  const stats = { total: 0, block: 0, chunk: 0, retries: 0, rate_limited: 0, by_endpoint: {} as Record<string, number> };
  // One lane per endpoint: each has its own pacing, so two endpoints of the provider carry the load side by side.
  type Lane = { url: string; gap: number; nextSlot: number; good: number };
  const lanes: Lane[] = endpoints.map((url) => ({ url, gap: paceMs, nextSlot: 0, good: 0 }));
  const pace = async (l: Lane) => {
    const at = Math.max(Date.now(), l.nextSlot);
    l.nextSlot = at + l.gap;
    if (at > Date.now()) await sleep(at - Date.now());
  };
  /** Least-busy lane first (ties keep the endpoint order); the others follow as fallbacks. */
  const ordered = (): Lane[] => {
    const first = lanes.reduce((a, b) => (b.nextSlot < a.nextSlot ? b : a));
    return [first, ...lanes.filter((l) => l !== first)];
  };

  async function once(lane: Lane, method: string, params: unknown): Promise<unknown> {
    const url = lane.url;
    await pace(lane);
    stats.total++;
    if (method === "block") stats.block++;
    else if (method === "chunk") stats.chunk++;
    stats.by_endpoint[url] = (stats.by_endpoint[url] ?? 0) + 1;
    let res: Response;
    try {
      res = await f(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "arrow-team-made", method, params }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new RpcFailure(`${url}: ${(e as Error).message}`, null, true);
    }
    if (res.status === 429) {
      stats.rate_limited++;
      lane.gap = Math.min(Math.ceil(lane.gap * 1.5), MAX_GAP_MS);
      lane.good = 0;
    }
    if (res.status === 429 || res.status >= 500) throw new RpcFailure(`${url}: HTTP ${res.status}`, null, true);
    if (++lane.good >= 10) {
      lane.gap = Math.max(paceMs, Math.floor(lane.gap * 0.85));
      lane.good = 0;
    }
    const body = (await res.json()) as { result?: unknown; error?: { cause?: { name?: string }; name?: string; data?: unknown } };
    if (body.error) {
      const name = body.error.cause?.name ?? body.error.name ?? null;
      throw new RpcFailure(`${url}: ${name ?? JSON.stringify(body.error).slice(0, 120)}`, name, name === "TIMEOUT_ERROR" || name === "INTERNAL_ERROR");
    }
    return body.result;
  }

  /** Tries the least-busy endpoint, then the others. A missing block/chunk moves on to the next endpoint; transient errors are retried. */
  async function call(method: (typeof METHODS)[number], params: unknown): Promise<unknown> {
    let last: unknown = new Error("no endpoint");
    for (const lane of ordered()) {
      for (let attempt = 0; attempt <= waits.length; attempt++) {
        try {
          return await once(lane, method, params);
        } catch (e) {
          last = e;
          if (!(e instanceof RpcFailure) || !e.retryable) break;
          if (attempt < waits.length) {
            stats.retries++;
            await sleep(waits[attempt]!);
          }
        }
      }
      if (last instanceof RpcFailure && last.causeName !== null && !MISSING.has(last.causeName)) throw last;
    }
    throw last;
  }

  return {
    stats,
    head: async () => BlockView.parse(await call("block", { finality: "final" })),
    /** The block at `height`, or null when the slot was skipped (no endpoint has it). */
    blockAt: async (height: number): Promise<Block | null> => {
      try {
        return BlockView.parse(await call("block", { block_id: height }));
      } catch (e) {
        if (e instanceof RpcFailure && e.causeName !== null && MISSING.has(e.causeName)) return null;
        throw e;
      }
    },
    chunk: async (hash: string): Promise<Chunk> => ChunkView.parse(await call("chunk", { chunk_id: hash })),
  };
}

/** Optional resume file (JSONL, scratch space, never committed): finished rows and the request counters survive a crash. */
export type Cache = { read: () => string | null; append: (line: string) => void };

type Meta = { type: "meta"; started: string; head: Block; stride: number; rows: number };
type CachedRow = { type: "row"; i: number; row: Row; skipped: boolean };
type CachedStats = { type: "stats"; stats: ReturnType<typeof makeClient>["stats"] };

export async function collect(opts: { rows: number; stride: number; head?: number }, client = makeClient(), cache?: Cache) {
  let started = new Date().toISOString().slice(0, 19) + "Z";
  let headBlock: Block | null = null;
  const done = new Map<number, CachedRow>();
  const old = cache?.read();
  if (old) {
    for (const line of old.split("\n").filter(Boolean)) {
      const j = JSON.parse(line) as Meta | CachedRow | CachedStats;
      if (j.type === "meta") {
        if (j.stride !== opts.stride || j.rows < opts.rows) throw new Error("cache file was made with other --rows/--stride");
        headBlock = j.head;
        started = j.started;
      } else if (j.type === "row") { if (j.i < opts.rows) done.set(j.i, j); }
      else Object.assign(client.stats, j.stats);
    }
  }
  if (!headBlock) {
    headBlock = opts.head === undefined ? await client.head() : await client.blockAt(opts.head);
    if (!headBlock) throw new Error(`no block at head height ${opts.head}`);
    cache?.append(JSON.stringify({ type: "meta", started, head: headBlock, stride: opts.stride, rows: opts.rows } satisfies Meta));
  }
  const heights = sampleHeights(headBlock.header.height, opts.rows, opts.stride);
  const out: (Row | undefined)[] = new Array(heights.length);
  let skipped = 0;
  for (const [i, c] of done) { out[i] = c.row; if (c.skipped) skipped++; }
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= heights.length) return;
      if (out[i]) continue;
      let block: Block | null = null;
      let skippedHere = false;
      for (let d = 0; d < SKIP_WALK && !block; d++) {
        block = i === 0 && d === 0 ? headBlock! : await client.blockAt(heights[i]! - d);
        if (!block && d === 0) { skipped++; skippedHere = true; }
      }
      if (!block) throw new Error(`no block within ${SKIP_WALK} heights below ${heights[i]}`);
      const chunks: Chunk[] = [];
      for (const c of newChunks(block)) chunks.push(await client.chunk(c.chunk_hash));
      out[i] = aggregate(block, chunks);
      cache?.append(JSON.stringify({ type: "row", i, row: out[i], skipped: skippedHere } satisfies CachedRow));
      cache?.append(JSON.stringify({ type: "stats", stats: client.stats } satisfies CachedStats));
      if ((i + 1) % 10 === 0) console.log(`  ${new Date().toISOString().slice(11, 19)}Z block ${i + 1}/${heights.length} · ${client.stats.total} requests, ${client.stats.rate_limited} HTTP 429, ${client.stats.retries} retries`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const rows = (out as Row[]).sort((a, b) => Number(a.block_height) - Number(b.block_height));
  const csv = toCsv(rows);
  const first = rows[0]!, last = rows[rows.length - 1]!;
  const manifest: Manifest = {
    v: 1,
    title: TITLE,
    source: "NEAR mainnet public JSON-RPC (block and chunk queries)",
    endpoints: [...ENDPOINTS],
    methods: [...METHODS],
    head: { height: headBlock.header.height, hash: headBlock.header.hash, timestamp_utc: isoSeconds(headBlock.header.timestamp_nanosec) },
    stride: opts.stride,
    rows: rows.length,
    first: { height: Number(first.block_height), ts_utc: first.block_ts },
    last: { height: Number(last.block_height), ts_utc: last.block_ts },
    skipped_heights: skipped,
    requests: client.stats,
    collection: { started_utc: started, finished_utc: new Date().toISOString().slice(0, 19) + "Z" },
    csv: { path: `${OUT_DIR}/${CSV_NAME}`, sha256: createHash("sha256").update(csv).digest("hex"), bytes: Buffer.byteLength(csv) },
  };
  return { csv, manifest };
}

// ---- CLI ---------------------------------------------------------------------------------------------------------

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const args = process.argv.slice(2);
  const num = (name: string, d: number) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : d);
  const readRel = (rel: string) => (existsSync(resolve(root, rel)) ? readFileSync(resolve(root, rel), "utf8") : null);

  if (args.includes("--check")) {
    const r = checkDataset(readRel);
    for (const p of r.problems) console.error(`PROBLEM ${p}`);
    if (r.ok) console.log(`team-made: columns OK, ${r.rows} rows == manifest, sha256 OK, SOURCE.md in sync, 0 emails/URLs in cells`);
    process.exit(r.ok ? 0 : 1);
  }

  const rows = num("--rows", 500), stride = num("--stride", 600);
  const head = args.includes("--head") ? num("--head", 0) : undefined;
  console.log(`collecting ${rows} blocks, stride ${stride}${head === undefined ? ", head = final block" : `, head ${head}`}`);
  const cachePath = args.includes("--cache") ? resolve(args[args.indexOf("--cache") + 1]!) : null;
  const cache: Cache | undefined = cachePath ? { read: () => (existsSync(cachePath) ? readFileSync(cachePath, "utf8") : null), append: (l) => appendFileSync(cachePath, l + "\n") } : undefined;
  const { csv, manifest } = await collect({ rows, stride, head }, makeClient(), cache);
  mkdirSync(resolve(root, OUT_DIR), { recursive: true });
  writeFileSync(resolve(root, manifest.csv.path), csv);
  writeFileSync(resolve(root, `${OUT_DIR}/manifest.json`), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(resolve(root, `${OUT_DIR}/SOURCE.md`), renderSource(manifest));
  console.log(`${manifest.requests.total} requests (${manifest.requests.block} block, ${manifest.requests.chunk} chunk, ${manifest.requests.retries} retries) · rows: ${manifest.rows} · wrote ${OUT_DIR}/{${CSV_NAME},manifest.json,SOURCE.md}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
