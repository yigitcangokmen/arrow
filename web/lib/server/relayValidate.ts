// Allowlist for /api/relay. The relayer key pays gas for execute_intents, so anything that is not a plain Arrow
// list/eval/buy transfer to the market contract is refused: nobody gets a free gas station (WS5-T02).
import { ArrowMsg, type MultiPayload } from "@arrow/sdk/schemas";

export interface RelayValidateConfig {
  contract: string; // the market contract (mainnet)
  usdcToken: string; // intents token id, "nep141:..."
  now?: number;
}

export type Validated =
  | { ok: true; signerId: string; op: "list" | "eval" | "buy"; amount: bigint; listingId: number | null }
  | { ok: false; status: 400 | 403; code: "BAD_REQUEST" | "NOT_ARROW_INTENT"; error: string };

const MAX_DEADLINE_MS = 60 * 60_000;
const bad = (error: string): Validated => ({ ok: false, status: 400, code: "BAD_REQUEST", error });
const refused = (error: string): Validated => ({ ok: false, status: 403, code: "NOT_ARROW_INTENT", error });

export function validateArrowMultipayload(mp: MultiPayload, cfg: RelayValidateConfig): Validated {
  if (mp.standard !== "erc191" || typeof mp.payload !== "string" || typeof mp.signature !== "string") {
    return bad("multipayload must be {standard:\"erc191\", payload, signature}");
  }
  let p: any;
  try {
    p = JSON.parse(mp.payload);
  } catch {
    return bad("payload is not JSON");
  }
  if (typeof p !== "object" || p === null) return bad("payload is not an object");

  if (typeof p.signer_id !== "string" || !/^0x[0-9a-f]{40}$/.test(p.signer_id)) return bad("signer_id must be a lowercase 0x address");
  if (p.verifying_contract !== "intents.near") return refused("verifying_contract must be intents.near");
  const now = cfg.now ?? Date.now();
  const deadline = typeof p.deadline === "string" ? Date.parse(p.deadline) : NaN;
  if (!Number.isFinite(deadline) || deadline <= now) return bad("deadline is missing or already passed");
  if (deadline > now + MAX_DEADLINE_MS) return bad("deadline is more than 60 minutes ahead");
  if (!Array.isArray(p.intents) || p.intents.length !== 1) return bad("exactly one intent is allowed");

  const intent = p.intents[0];
  if (intent?.intent !== "transfer") return refused("only transfer intents are relayed");
  if (intent.receiver_id !== cfg.contract) return refused(`receiver_id must be ${cfg.contract}`);
  const tokens = intent.tokens;
  const keys = typeof tokens === "object" && tokens !== null ? Object.keys(tokens) : [];
  if (keys.length !== 1 || keys[0] !== cfg.usdcToken) return refused("tokens must be exactly the USDC token");
  const rawAmount = tokens[cfg.usdcToken];
  if (typeof rawAmount !== "string" || !/^[0-9]{1,38}$/.test(rawAmount)) return refused("the USDC amount must be a decimal string");
  if (intent.min_gas === undefined || intent.min_gas === null) return refused("min_gas is required");

  if (typeof intent.msg !== "string") return refused("msg is required");
  let msg: unknown;
  try {
    msg = JSON.parse(intent.msg);
  } catch {
    return refused("msg is not JSON");
  }
  const parsed = ArrowMsg.safeParse(msg);
  if (!parsed.success) return refused("msg is not an Arrow list, eval or buy message");

  const m = parsed.data;
  return { ok: true, signerId: p.signer_id, op: m.op, amount: BigInt(rawAmount), listingId: m.op === "list" ? null : m.listing_id };
}
