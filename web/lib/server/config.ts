// What the form pages need from get_config and program_pubkey, as plain strings (props cross the server/client border).
import type { ArrowViews } from "@arrow/sdk/contract";

const str = (v: unknown, fallback: string): string => (typeof v === "string" && /^\d+$/.test(v) ? v : fallback);
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isInteger(v) ? v : fallback);

export interface SellerConfig {
  programPk: string | null;
  /** listing_bond, USDC base units. */
  bond: string;
  limits: { minPrice: string; minEvalFee: string };
  maxEvalsCap: number;
  programWasmHash: string | null;
}

export async function sellerConfig(views: Pick<ArrowViews, "config" | "programPubkey">): Promise<SellerConfig> {
  const [cv, programPk] = await Promise.all([views.config(), views.programPubkey()]);
  const c = cv.config as Record<string, unknown>;
  return {
    programPk,
    bond: str(c.listing_bond, "100000"),
    limits: { minPrice: str(c.min_price, "100000"), minEvalFee: str(c.min_eval_fee, "50000") },
    maxEvalsCap: num(c.max_evals_cap, 500),
    programWasmHash: typeof c.program_wasm_hash === "string" ? c.program_wasm_hash : null,
  };
}
