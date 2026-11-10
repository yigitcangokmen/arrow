// The Node floor of package.json "engines" (near-api-js 7.4.0 needs >=22.22.2). Node 18 is end of life and is what a plain
// non-interactive shell opens, so the scripts that hold keys check it themselves; npm does not enforce engines when running a script.
export const MIN_NODE = [22, 22, 2] as const;

export const atLeast = (v: string, min: readonly number[]) => {
  const a = v.split(".").map(Number);
  for (let i = 0; i < min.length; i++) if ((a[i] ?? 0) !== min[i]) return (a[i] ?? 0) > min[i];
  return true;
};

/** The message to print when this Node is too old, or null. */
export const nodeProblem = (version: string): string | null =>
  atLeast(version, MIN_NODE) ? null : `Node ${MIN_NODE.join(".")} or newer is needed (found ${version}). Run: nvm use`;
