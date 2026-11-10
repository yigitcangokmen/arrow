import { shortHash } from "../links.ts";
import { num, type VerifyCtx } from "../context.ts";
import { lc, row } from "./util.ts";

export const TITLE = "program wasm hash: contract == release == url == attestation";

/** R1: the program hash the contract points at is the released file, is what the URL serves, and is what ran. */
export async function r1(ctx: VerifyCtx) {
  const cfg = (await ctx.config()).config as { program_wasm_hash?: string; program_wasm_url?: string };
  const contractHash = lc(cfg.program_wasm_hash);
  const url = cfg.program_wasm_url ?? "";
  const release = lc(ctx.opts.releaseSha256?.trim());
  if (!release) return row("R1", "NOT PROVEN", true, TITLE, "release/sha256.txt not provided (written at the freeze)");
  const served = await ctx.urlSha256(url);

  // STATE-2: an eval ran the program its listing was sealed to. After set_program, evals on listings sealed to an older
  // program are history, not a mismatch; only evals on listings listed under the current program are compared.
  const programOf = new Map((await ctx.listings()).map((l) => [num(l.id), lc(l.program_hash_at_list)]));
  const facts = (await ctx.evalFacts()).filter((f) => f.attestation);
  const current = facts.filter((f) => f.run.listing_id === null || programOf.get(num(f.run.listing_id)) === contractHash);
  const older = facts.length - current.length;
  const wrong: string[] = [];
  let matched = 0;
  for (const f of current) {
    const a = f.attestation!;
    const okWasm = lc(a.wasm_hash) === contractHash;
    const okExec = a.executed_wasm_sha256 === undefined || a.executed_wasm_sha256 === null || lc(a.executed_wasm_sha256) === contractHash;
    if (okWasm && okExec) matched++;
    else wrong.push(`${f.run.id}: attestation ${shortHash(lc(a.wasm_hash))}${okWasm ? "" : " wasm_hash"}${okExec ? "" : " executed_wasm_sha256"} differs`);
  }

  const chain = `contract ${shortHash(contractHash)} · release ${shortHash(release)} · url ${shortHash(served)}`;
  if (!contractHash || contractHash !== release || release !== served) return row("R1", "NOT PROVEN", true, TITLE, `hash chain differs: ${chain}`);
  if (wrong.length) return row("R1", "NOT PROVEN", true, TITLE, wrong.join("; "));
  if (matched === 0) {
    if (older > 0) return row("R1", "NOT PROVEN", true, TITLE, `contract == release == url (${shortHash(contractHash)}) but no eval under the current program yet (${older} under older programs)`);
    const notes = [...new Set((await ctx.evalFacts()).map((f) => f.note))].join(", ") || "no eval run in evidence";
    return row("R1", "NOT PROVEN", true, TITLE, `contract == release == url (${shortHash(contractHash)}) but no stored attestation to compare: ${notes}`);
  }
  return row("R1", "PROVEN", true, TITLE, `${shortHash(contractHash)} · attestation wasm_hash equal on ${matched} eval${matched === 1 ? "" : "s"}${older ? ` (${older} under older programs not compared)` : ""}`);
}
