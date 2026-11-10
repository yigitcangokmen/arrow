import { isAbsolute, relative, resolve } from "node:path";
import { mainCheckout, repoRoot } from "./env.ts";

/** True when p is inside this checkout or the main checkout (a key file written there could be committed). */
export function isInsideRepo(p: string): boolean {
  const abs = resolve(p);
  return [repoRoot(), mainCheckout()].some((root) => {
    const rel = relative(root, abs);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
}
