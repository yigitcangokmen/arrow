// zod schemas that mirror the contract/enclave serde types. They are tested against the same JSON vectors in
// fixtures/ as the Rust side. Encoding rules: fixtures/README.md.
import { z } from "zod";

const cpLen = (s: string) => [...s].length; // Rust counts chars, not UTF-16 units
const chars = (min: number, max: number) =>
  z.string().refine((s) => cpLen(s) >= min && cpLen(s) <= max, { message: `${min}..${max} characters` });

const hexLower = (n: number) => z.string().regex(new RegExp(`^[0-9a-f]{${n}}$`), `${n} lowercase hex`);
const b64 = z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, "standard base64 with padding");
const b64Len = (n: number) => b64.refine((s) => s.length === n, { message: `${n} base64 characters` });

const U64_MAX_SAFE = z.number().int().nonnegative();
const U128 = z
  .string()
  .refine((s) => /^\d+$/.test(s) && BigInt(s) < 2n ** 128n, { message: "u128 as a decimal string" });

const NEAR_ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const Payout = z.string().refine(
  (s) => /^0x[0-9a-f]{40}$/.test(s) || (s.length >= 2 && s.length <= 64 && NEAR_ACCOUNT.test(s)),
  { message: "Intents 0x address or NEAR account id" },
);
/** The contract's `sender_id` form: a lowercase Intents 0x address or a NEAR account id. */
export const isAccountId = (s: string): boolean => Payout.safeParse(s).success;

export const MAX_OUTPUT_BYTES = 900; // OutLayer blockchain-mode limit (DEC I-07)
export const MAX_CRITERIA_BYTES = 2975; // sealed_criteria <= 4140 b64 chars = 3104 bytes minus 97 ECIES overhead and the 32-byte bind
export const ModeSchema = z.enum(["verdict", "scored"]);

// ---------- msg (ft_on_transfer / mt_on_transfer) ----------
export const ListMsg = z.strictObject({
  op: z.literal("list"),
  title: chars(1, 80),
  public_desc: chars(0, 280),
  columns: z.array(chars(1, 40)).min(1).max(64),
  rows_claimed: U64_MAX_SAFE,
  blob_url: z
    .string()
    .max(200)
    .regex(/^https:\/\/[^\s\u0000-\u001f\u007f]+$/, "https URL without whitespace or control characters"),
  blob_sha256: hexLower(64),
  sealed_k: b64Len(260),
  price: U128,
  eval_fee: U128,
  max_evals: z.number().int().min(1).max(500),
  mode: ModeSchema,
  payout: Payout.optional(),
});
export const EvalMsg = z.strictObject({
  op: z.literal("eval"),
  listing_id: U64_MAX_SAFE,
  sealed_criteria: b64.refine((s) => s.length >= 1 && s.length <= 4140, { message: "1..4140 base64 characters" }),
  buyer_pk: hexLower(130).refine((s) => s.startsWith("04"), { message: "uncompressed secp256k1 key (04...)" }),
});
export const BuyMsg = z.strictObject({
  op: z.literal("buy"),
  listing_id: U64_MAX_SAFE,
  buyer_pk: hexLower(130).refine((s) => s.startsWith("04"), { message: "uncompressed secp256k1 key (04...)" }),
});
export const ArrowMsg = z.discriminatedUnion("op", [ListMsg, EvalMsg, BuyMsg]);
export type ListMsg = z.infer<typeof ListMsg>;
export type EvalMsg = z.infer<typeof EvalMsg>;
export type BuyMsg = z.infer<typeof BuyMsg>;
export type ArrowMsg = z.infer<typeof ArrowMsg>;

// ---------- buyer criteria (sealed to the program key) ----------
const utf8Len = (s: string) => new TextEncoder().encode(s).length;
const Date10 = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const Criteria = z
  .strictObject({
    v: z.literal(1),
    required_columns: z.array(chars(1, 40)).max(64).optional(),
    min_rows: z.number().int().min(0).max(200000).optional(),
    date_column: chars(1, 40).optional(),
    date_from: Date10.optional(),
    date_to: Date10.optional(),
    max_null_rate: z.number().min(0).max(1).optional(),
    key_column: chars(1, 40).optional(),
    text: chars(0, 600),
    min_fit: z.number().int().min(1).max(5).optional(), // default 4, applied by the enclave
    min_novelty: z.number().int().min(1).max(5).optional(), // default 3, applied by the enclave
    minhash: hexLower(2048).optional(),
  })
  .refine((c) => utf8Len(JSON.stringify(c)) <= MAX_CRITERIA_BYTES, {
    message: "criteria too large: shorten text",
  });
export type Criteria = z.infer<typeof Criteria>;

/** Byte size of the minified criteria JSON, the number the 2975 limit applies to. */
export const criteriaBytes = (c: unknown): number => utf8Len(JSON.stringify(c));

// ---------- enclave output (callback payload) ----------
const Hash = hexLower(64);
export const EvalOut = z.strictObject({ v: z.literal(1), ok: z.literal(true), r: b64Len(132), h: Hash });
export const ReleaseOut = z.strictObject({ v: z.literal(1), ok: z.literal(true), k: b64Len(172), h: Hash });
export const DeriveOut = z.strictObject({
  v: z.literal(1),
  ok: z.literal(true),
  pk: hexLower(130).refine((s) => s.startsWith("04"), { message: "uncompressed secp256k1 key" }),
});
export const ErrOut = z.strictObject({ v: z.literal(1), ok: z.literal(false) });
export const ArrowOut = z.union([EvalOut, ReleaseOut, DeriveOut, ErrOut]);
export type ArrowOut = z.infer<typeof ArrowOut>;

/** Parses the exact callback bytes. Throws on >900 bytes, non-JSON, or a shape that is not one of the four outputs. */
export function parseArrowOut(raw: string): ArrowOut {
  if (utf8Len(raw) > MAX_OUTPUT_BYTES) throw new Error(`output exceeds ${MAX_OUTPUT_BYTES} bytes`);
  return ArrowOut.parse(JSON.parse(raw));
}

// ---------- contract views (loose: unknown fields pass; names follow WS-2 views.rs) ----------
const Id = z.union([z.number().nonnegative(), z.string().regex(/^\d+$/)]); // u64 timestamps exceed 2^53: number or string
const Nullable = <T extends z.ZodType>(t: T) => t.nullish();
const Status = z.enum(["escrowed", "pending", "done", "refunded"]);
const Rail = z.enum(["mt", "ft"]);

export const Listing = z.looseObject({
  id: Id,
  seller: z.string(),
  payout: z.string().optional(),
  title: z.string(),
  public_desc: z.string(),
  columns: z.array(z.string()),
  rows_claimed: Id,
  blob_url: z.string(),
  blob_sha256: Hash,
  sealed_k: z.string(),
  price: U128,
  eval_fee: U128,
  max_evals: z.number().int(),
  evals_used: z.number().int(),
  bits_per_eval_milli: z.number().int(),
  mode: ModeSchema,
  program_hash_at_list: z.string().optional(),
  created_at_ns: Id,
});
export type Listing = z.infer<typeof Listing>;

export const Eval = z.looseObject({
  id: Id,
  listing_id: Id,
  buyer: z.string(),
  buyer_pk: z.string(),
  paid: U128.optional(),
  fee: U128.optional(),
  rail: Rail.optional(),
  status: Status,
  sealed_result: Nullable(z.string()),
  h: Nullable(Hash),
  refund_reason: Nullable(z.string()),
  created_at_ns: Id.optional(),
  settled_at_ns: Nullable(Id),
});
export type Eval = z.infer<typeof Eval>;

export const Purchase = z.looseObject({
  id: Id,
  listing_id: Id,
  buyer: z.string(),
  buyer_pk: z.string(),
  paid: U128.optional(),
  price: U128.optional(),
  rail: Rail.optional(),
  status: Status,
  sealed_k_buyer: Nullable(z.string()),
  h: Nullable(Hash),
  refund_reason: Nullable(z.string()),
  created_at_ns: Id.optional(),
  settled_at_ns: Nullable(Id),
});
export type Purchase = z.infer<typeof Purchase>;

export const LeakBudget = z.looseObject({
  listing_id: Id,
  bits_per_eval_milli: z.number().int(),
  max_evals: z.number().int(),
  evals_used: z.number().int(),
  budget_milli: z.number().int(),
  spent_milli: z.number().int(),
  left_milli: z.number().int(),
});
export type LeakBudget = z.infer<typeof LeakBudget>;

export const ConfigView = z.looseObject({
  config: z.looseObject({}),
  paused: z.boolean(),
  tank_available: U128,
  payment_path: z.enum(["notify", "escrow"]),
  result_path: z.string(),
  build: z.enum(["mainnet", "testnet"]),
});
export type ConfigView = z.infer<typeof ConfigView>;

// ---------- API contracts (owner: WS-5, PLAN WS-5 section 1.3; single copy lives here) ----------
export const MultiPayload = z.looseObject({ standard: z.literal("erc191"), payload: z.string(), signature: z.string() });
export type MultiPayload = z.infer<typeof MultiPayload>;
export const RelayRequest = z.strictObject({ multipayload: MultiPayload });
export const RelayResponse = z.looseObject({ txHash: z.string(), signerId: z.string() });
export const SponsorRequest = z.strictObject({ publicKey: z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/) });
export const SponsorResponse = z.looseObject({ accountId: z.string(), txHash: z.string(), nearAmount: z.string() });
export const ApiError = z.looseObject({
  error: z.string(),
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  fallback: z.string().optional(),
  detail: z.string().optional(),
});
export type RelayRequest = z.infer<typeof RelayRequest>;
export type RelayResponse = z.infer<typeof RelayResponse>;
export type SponsorRequest = z.infer<typeof SponsorRequest>;
export type SponsorResponse = z.infer<typeof SponsorResponse>;
export type ApiError = z.infer<typeof ApiError>;

// ---------- bench replay ----------
export const SignatureRecord = z.strictObject({
  chat_id: z.string(),
  model: z.string(),
  signing_algo: z.literal("ecdsa"),
  request_sha256: Hash,
  response_sha256: Hash,
  text: z.string(),
  signature: z.string(),
  signing_address: z.string(),
  fetched_utc: z.string(),
});
export type SignatureRecord = z.infer<typeof SignatureRecord>;

// ---------- evidence files (PLAN A.3) ----------
export const EvidenceRun = z.object({
  id: z.string().min(1),
  kind: z.enum(["list", "eval", "buy", "refund", "inbound", "outbound", "attack", "spike", "deploy", "lock"]),
  tx: z.string().nullable(),
  chain: z.enum(["near", "base", "solana"]),
  block_height: z.number().int().nullable(),
  timestamp_utc: z.string(),
  listing_id: Id.nullable(),
  eval_id: Id.nullable(),
  purchase_id: Id.nullable(),
  oneclick_deposit: z.string().nullable(),
  expect: z.string(),
  observed: z.string(),
  script: z.string(),
  commit: z.string(),
  /** STATE-2: the market contract and program the run used; runs without them predate the field. */
  contract: z.string().optional(),
  program_wasm_sha256: Hash.optional(),
});
export type EvidenceRun = z.infer<typeof EvidenceRun>;

export const EvidenceFile = z.object({
  network: z.enum(["testnet", "mainnet"]),
  contract: z.string(),
  contract_wasm_sha256: Hash.nullable(),
  program_wasm_sha256: Hash.nullable(),
  program_wasm_url: z.string().nullable(),
  lock: z.object({ tx: z.string().nullable(), block_height: z.number().nullable(), timestamp_utc: z.string().nullable() }),
  accounts: z.record(z.string(), z.string()),
  runs: z.array(EvidenceRun),
  corrections: z.array(z.unknown()),
});
export type EvidenceFile = z.infer<typeof EvidenceFile>;

export const VersionView = z.looseObject({
  name: z.string(),
  version: z.string(),
  payment_path: z.enum(["notify", "escrow"]),
  result_path: z.string(),
  build: z.enum(["mainnet", "testnet"]),
});
export type VersionView = z.infer<typeof VersionView>;
