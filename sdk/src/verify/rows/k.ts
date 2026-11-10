import { NETWORKS } from "../../config.ts";
import { viewAccount } from "../../rpc.ts";
import type { VerifyCtx } from "../context.ts";
import { row, why } from "./util.ts";

async function codeHash(ctx: VerifyCtx, network: "mainnet" | "testnet", account: string): Promise<string> {
  try {
    return `code hash ${(await viewAccount(network, account, ctx.rpcOpts)).code_hash}`;
  } catch (e) {
    return `code hash unavailable: ${why(e)}`;
  }
}

/** K1..K7: known open risks. Always RISKY, never REQUIRED. Wording follows the trust table. */
export async function riskyRows(ctx: VerifyCtx) {
  const outlayer = ctx.cfg.outlayer;
  const intents = NETWORKS.mainnet.intents!;
  const k2 =
    ctx.network === "mainnet"
      ? row("K2", "RISKY", false, `${intents} is upgradable (${await codeHash(ctx, "mainnet", intents)})`, "payments and refunds on mainnet pass through its resolver")
      : row("K2", "RISKY", false, `${intents} is upgradable`, "mainnet rail only; testnet pays with the NEP-141 aUSD token");
  const timing =
    ctx.opts.timingBits === undefined
      ? "no measured value yet; a side channel through enclave run time is not ruled out"
      : `measured ${ctx.opts.timingBits} bits in the bench; a side channel through enclave run time is not ruled out`;
  return [
    row("K1", "RISKY", false, `${outlayer} is upgradable (${await codeHash(ctx, ctx.network, outlayer)})`, "an upgrade can change how requests are executed"),
    k2,
    row("K3", "RISKY", false, "OutLayer keystore is run by a DAO", "which code may read the program key and the API key secret is decided there"),
    row("K4", "RISKY", false, "OutLayer master key is shared", "all projects on the same OutLayer deployment sit under one master"),
    row("K5", "RISKY", false, "timing side channel", timing),
    row("K6", "RISKY", false, "time guard reads the host clock", "a skewed host clock can pass an old request or refuse a fresh one"),
    row("K7", "RISKY", false, "leak budget can be burned", "an eval counts when accepted and never comes back, even when refunded; a buyer can use up a listing's budget with failing evals"),
  ];
}
