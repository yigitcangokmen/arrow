// The contract's own preconditions that no payment can get past (E05, E06, E10, E13), computed from get_config.
// The relay uses them to refuse before it spends gas; the buy page uses them to say why Inspect and Buy are off.
import type { ConfigView } from "@arrow/sdk/schemas";

export const BLOCKER_CODES = ["MARKET_PAUSED", "PROGRAM_KEY_MISSING", "TANK_LOW", "LISTING_STALE"] as const;
export type BlockerCode = (typeof BLOCKER_CODES)[number];
export interface Blocker {
  code: BlockerCode;
  message: string;
}

export interface MarketState {
  paused: boolean;
  programPkSet: boolean;
  tankAvailable: bigint;
  tankMin: bigint;
  depositEval: bigint;
  depositRelease: bigint;
  programWasmHash: string | null;
}

const big = (v: unknown): bigint => (typeof v === "string" && /^\d+$/.test(v) ? BigInt(v) : 0n);

export function marketStateFrom(cv: ConfigView, programPk: string | null): MarketState {
  const c = cv.config as Record<string, unknown>;
  return {
    paused: cv.paused,
    programPkSet: programPk !== null,
    tankAvailable: BigInt(cv.tank_available),
    tankMin: big(c.tank_min),
    depositEval: big(c.outlayer_deposit_eval),
    depositRelease: big(c.outlayer_deposit_release),
    programWasmHash: typeof c.program_wasm_hash === "string" ? c.program_wasm_hash : null,
  };
}

/** contracts/arrow types.rs LIST_TANK_RESERVE_EVALS. */
const LIST_TANK_RESERVE_EVALS = 10n;
/** Storage of the largest listing the msg rules allow (about 5 KB at 1e19 yocto a byte), paid from the tank. */
const LIST_STORAGE_MARGIN = 5n * 10n ** 22n;

/** Why a payment for `op` would panic in mt_on_transfer. `listing` is needed for eval and buy (E13). */
export function blockersFor(op: "list" | "eval" | "buy" | "rehost", m: MarketState, listing?: { program_hash_at_list?: string }): Blocker[] {
  const out: Blocker[] = [];
  if (m.paused) out.push({ code: "MARKET_PAUSED", message: "The market is paused." });
  if (!m.programPkSet) out.push({ code: "PROGRAM_KEY_MISSING", message: "The enclave program key is not published." });
  if (op === "rehost") return out; // handle_rehost checks only assert_open
  if (op !== "list" && listing && listing.program_hash_at_list !== m.programWasmHash) {
    out.push({ code: "LISTING_STALE", message: "This listing was sealed to an older enclave program and can no longer be inspected or bought." });
  }
  // C-02: after it stores the listing, the contract wants tank_min plus LIST_TANK_RESERVE_EVALS evals left (E10), and refunds the bond if not.
  const deposit = op === "eval" ? m.depositEval : op === "buy" ? m.depositRelease : LIST_TANK_RESERVE_EVALS * m.depositEval + LIST_STORAGE_MARGIN;
  if (m.tankAvailable < m.tankMin + deposit) out.push({ code: "TANK_LOW", message: "The market's gas tank is low, so it is not accepting new requests until it is topped up." });
  return out;
}
