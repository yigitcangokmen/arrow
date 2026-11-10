import { reportDataVersion } from "../attestation.ts";
import type { VerifyCtx } from "../context.ts";
import { row } from "./util.ts";

export const TITLE = "TDX quote report_data == sha256 of the attestation fields";

/** I2: recomputes report_data (V1, else V0). The quote signature is not verified here; the browser does DCAP on /verify. */
export async function i2(ctx: VerifyCtx) {
  const facts = (await ctx.evalFacts()).filter((f) => f.attestation);
  if (facts.length === 0) return row("I2", "NOT PROVEN", false, TITLE, "no stored attestation to recompute");
  const versions = new Set<string>();
  const bad: string[] = [];
  for (const f of facts) {
    const v = reportDataVersion(f.attestation!);
    if (v) versions.add(v);
    else bad.push(f.run.id);
  }
  if (bad.length) return row("I2", "NOT PROVEN", false, TITLE, `report_data differs from both formulas for ${bad.join(", ")}`);
  return row("I2", "PROVEN", false, TITLE, `${facts.length} quote${facts.length === 1 ? "" : "s"} match (${[...versions].join(", ")}). The quote signature is not verified in this command; DCAP runs in the browser on /verify`);
}
