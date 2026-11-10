// Shared env + repo-path helpers (WS4-T08, DEC D4-02, D4-03). The one .env lives in the main checkout.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export class EnvKeyExistsError extends Error {
  constructor(public readonly envName: string) {
    super(`${envName} already set; refusing to overwrite`);
    this.name = "EnvKeyExistsError";
  }
}

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: HERE, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** Directory of this checkout's top level (a worktree reports its own directory). */
export function repoRoot(): string {
  return git(["rev-parse", "--show-toplevel"]) ?? resolve(HERE, "../../..");
}

/** The main checkout: ledgers (evidence/, STATUS.md) and .env live here, also when running in a worktree. */
export function mainCheckout(): string {
  const common = git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return common ? dirname(common) : resolve(HERE, "../../..");
}

export function envPath(): string {
  return process.env.ARROW_ENV_PATH || resolve(mainCheckout(), ".env");
}

export function loadEnv(): void {
  try {
    process.loadEnvFile(envPath());
  } catch {
    // no .env yet: callers use requireEnv where a value is mandatory
  }
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in ${envPath()}`);
  return v;
}

/**
 * Write NAME=value into the env file. Creates the file with mode 0600, fills an empty `NAME=` line in place,
 * appends otherwise, and throws EnvKeyExistsError when NAME already has a value. Never logs the value.
 */
export function setEnvSecret(name: string, value: string, opts: { path?: string } = {}): { created: boolean } {
  const path = opts.path ?? envPath();
  const created = !existsSync(path);
  const text = created ? "" : readFileSync(path, "utf8");
  const lines = text.split("\n");
  const prefix = `${name}=`;
  const at = lines.findIndex((l) => l.startsWith(prefix));
  if (at >= 0) {
    if (lines[at].slice(prefix.length).trim() !== "") throw new EnvKeyExistsError(name);
    lines[at] = prefix + value;
    writeFileSync(path, lines.join("\n"), { mode: 0o600 });
  } else {
    const sep = text === "" || text.endsWith("\n") ? "" : "\n";
    writeFileSync(path, `${text}${sep}${prefix}${value}\n`, { mode: 0o600 });
  }
  chmodSync(path, 0o600);
  return { created };
}
