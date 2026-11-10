import { viewAccount } from "../../rpc.ts";
import type { VerifyCtx } from "../context.ts";
import { base58ToHex, shortHash } from "../links.ts";
import { row } from "./util.ts";

export const TITLE = "contract code hash == contract_wasm_sha256 in evidence";

export async function i3(ctx: VerifyCtx) {
  const want = ctx.evidence.contract_wasm_sha256;
  if (!want) return row("I3", "NOT PROVEN", false, TITLE, "no contract_wasm_sha256 recorded in evidence");
  const got = base58ToHex((await viewAccount(ctx.network, ctx.contract, ctx.rpcOpts)).code_hash);
  if (got !== want) return row("I3", "NOT PROVEN", false, TITLE, `on-chain ${shortHash(got)} != evidence ${shortHash(want)}`);
  return row("I3", "PROVEN", false, TITLE, `${ctx.contract} runs ${shortHash(got)}`);
}
