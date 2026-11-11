// CRY-4: the program key is HKDF of the OutLayer secret row's value, and the row's access rule is the only thing that ties
// it to this wasm and this contract. While the contract still has a key, its owner can move the rule to another build, read
// the value and move it back. Moving it bumps updated_at, so a row that was never changed and was made for the current
// program is the evidence that this did not happen. Not REQUIRED: the history before the row is only as complete as the
// recorded set_program txs.
import { functionCallArgs, rpc, view } from "../../rpc.ts";
import type { VerifyCtx } from "../context.ts";
import { shortHash } from "../links.ts";
import { lc, row } from "./util.ts";

export const TITLE = "program secret row: this wasm AND this contract only, never moved, created after the last set_program";

const isExpectedAccess = (access: any, hash: string, contract: string): boolean => {
  const logic = access?.Logic;
  const c = logic?.conditions;
  return (
    logic?.operator === "And" &&
    Array.isArray(c) &&
    c.length === 2 &&
    Object.keys(c[0] ?? {}).join() === "WasmHash" &&
    c[0].WasmHash?.hash === hash &&
    Object.keys(c[1] ?? {}).join() === "Predecessor" &&
    Object.keys(c[1].Predecessor?.condition ?? {}).join() === "Whitelist" &&
    JSON.stringify(c[1].Predecessor.condition.Whitelist.accounts) === JSON.stringify([contract])
  );
};

/** Block time (ns) of the newest recorded tx that set this program hash: set_program, or `new` for a program set at init. */
async function lastProgramSetNs(ctx: VerifyCtx, hash: string): Promise<bigint | null> {
  let last: bigint | null = null;
  for (const run of ctx.runs("deploy")) {
    if (!run.tx) continue;
    let tx: any;
    try {
      tx = await ctx.tx(run.tx, [ctx.contract]);
    } catch {
      continue;
    }
    if (tx?.status?.SuccessValue === undefined) continue;
    const at = { receiverId: ctx.contract };
    const sets = [
      ...functionCallArgs(tx, { ...at, methodName: "set_program" }).map((a) => a?.hash),
      ...functionCallArgs(tx, { ...at, methodName: "new" }).map((a) => a?.cfg?.program_wasm_hash),
    ];
    if (!sets.includes(hash)) continue;
    const block = await rpc<{ header?: { timestamp_nanosec?: string } }>(ctx.network, "block", { block_id: tx.transaction_outcome?.block_hash }, { ...ctx.rpcOpts, archival: true });
    const ns = block?.header?.timestamp_nanosec;
    if (typeof ns !== "string" || !/^\d+$/.test(ns)) continue;
    if (last === null || BigInt(ns) > last) last = BigInt(ns);
  }
  return last;
}

export async function i5(ctx: VerifyCtx) {
  const no = (detail: string) => row("I5", "NOT PROVEN", false, TITLE, detail);
  const hash = lc(((await ctx.config()).config as { program_wasm_hash?: string }).program_wasm_hash);
  const rows = await view<any[]>(ctx.network, ctx.cfg.outlayer, "list_user_secrets", { account_id: ctx.contract }, ctx.rpcOpts);
  const mine = (Array.isArray(rows) ? rows : []).filter((r) => r?.profile === "arrow" && r?.accessor?.WasmHash?.hash === hash);
  if (mine.length !== 1) return no(`${mine.length} arrow secret rows of ${ctx.contract} for ${shortHash(hash)} on ${ctx.cfg.outlayer} (want exactly 1)`);
  const s = mine[0];
  if (!isExpectedAccess(s.access, hash, ctx.contract)) return no(`access is not And[WasmHash ${shortHash(hash)}, Predecessor Whitelist [${ctx.contract}]]: ${JSON.stringify(s.access).slice(0, 160)}`);
  if (typeof s.created_at !== "number" || s.updated_at !== s.created_at) return no(`updated_at ${s.updated_at} != created_at ${s.created_at}: the row was changed after it was made, so its access may have been moved`);
  const setNs = await lastProgramSetNs(ctx, hash);
  if (setNs === null) return no(`no recorded set_program of ${shortHash(hash)} to compare the row's creation with`);
  if (BigInt(s.created_at) <= setNs) return no(`the row was created at ${s.created_at}, not after the last recorded set_program of ${shortHash(hash)} at ${setNs}`);
  return row("I5", "PROVEN", false, TITLE, `one row on ${ctx.cfg.outlayer}: And[WasmHash ${shortHash(hash)}, Predecessor [${ctx.contract}]], created_at == updated_at, created after the last recorded set_program`);
}
