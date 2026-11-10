// WS4-T17 (H-20): builds the hackathon submission payload, checks it against the LIVE contract in HACKATHON.md and shows it to the
// human. It never sends anything: the only network call is a GET of HACKATHON.md, and the curl command is printed, not run.
//   npx tsx scripts/src/submission-preview.ts [--dry] [--consent] [--project-name Arrow] [--lead-name "<..>"] [--email <..>]
//        [--size "1"|"2 - 4"|...] [--near-address <..>] [--project-url <..>] [--demo-url <..>] [--tracks privacy,agents,security,open]
// Inputs: ~/.config/arrow/submission-inputs.json (H-19; the human writes it), then any flag overrides a field. A human field that
// is in neither place is reported as missing and nothing is invented. The payload holds personal data, so it is written outside the
// repo (~/.config/arrow/submission.json, mode 0600) and `submission*.json` is gitignored.
// Exit: 0 payload valid · 1 HACKATHON.md unreadable or idea.txt missing · 2 invalid or missing fields · 3 HACKATHON.md changed.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { sha256Hex } from "@arrow/sdk";
import { configDir } from "../../agent/src/keys.ts";
import { repoRoot } from "./lib/env.ts";
import { mask } from "./lib/log.ts";
import { isInsideRepo } from "./lib/repo.ts";

export const HACKATHON_URL = "https://nearhackathon.com/HACKATHON.md";
export const CONSENT_NOTICE = "I agree that the organizers may use these details to review our submission and contact us about this hackathon.";
export const SIZES = ["1", "2 - 4", "4 - 6", "6 - 8", "8+"];
export const TRACK_IDS = ["defi", "thesis", "privacy", "business", "swarms", "security", "agents", "realworld", "games", "nfts", "memecoins", "social", "open"];
/** DEC T-04 */
export const DEFAULT_TRACKS = ["privacy", "agents", "security", "open"];
export const DEFAULT_PROJECT_NAME = "Arrow";
export const DEFAULT_PROJECT_URL = "https://github.com/yigitcangokmen/arrow";
/** The market contract accounts are locked and are never a payout address (DEC D-03). */
export const LOCKED_ADDRESSES = ["arrow-market.near", "arrow-market-v2.near"];
/** What the contract looked like when this script was written; docs/submission/checklist.md may carry a newer byte count. */
export const KNOWN_CONTRACT = { bytes: 22529, sha256: "6dd0c1ff2f98a2fc4b6339cd1cfad110e44ef0da761ba085028faa7e59c4868d", date: "2026-11-10" };
export const FIELDS = ["requestId", "projectName", "leadName", "email", "size", "tracks", "nearAddress", "projectUrl", "demoUrl", "idea", "consent"] as const;
/** the fields only the human can supply (HACKATHON.md "What the human decides"); demoUrl is the X post of H-19x */
export const HUMAN_FIELDS = ["leadName", "email", "size", "nearAddress", "demoUrl"] as const;
const NEAR_ADDRESS = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const MAX_BODY_BYTES = 12_000;

export interface Payload {
  requestId: string;
  projectName: string;
  leadName: string;
  email: string;
  size: string;
  tracks: string[];
  nearAddress: string;
  projectUrl: string;
  demoUrl: string;
  idea: string;
  consent: boolean;
}

export interface Flags {
  projectName?: string;
  leadName?: string;
  email?: string;
  size?: string;
  nearAddress?: string;
  projectUrl?: string;
  demoUrl?: string;
  tracks?: string;
  consent?: boolean;
}

export interface PreviewDeps {
  fetchImpl: typeof fetch;
  /** ~/.config/arrow: holds submission-inputs.json, submission-request-id and the written payload */
  dir: string;
  repo: string;
  say(line: string): void;
}

export interface PreviewResult {
  exit: number;
  payload?: Payload;
  errors: string[];
}

const isUrl = (s: string) => {
  try {
    return /^https?:$/.test(new URL(s).protocol);
  } catch {
    return false;
  }
};

/** A value the human has not filled in yet, such as "<2-80 chars>" from the template, counts as missing. */
const isBlank = (v: unknown) => typeof v !== "string" || v.trim() === "" || /^<.*>$/.test(v.trim());

/** The field rules of HACKATHON.md as read on 2026-11-10 plus the Arrow-specific locks. Returns one message per problem. */
export function validatePayload(p: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  const keys = Object.keys(p);
  if (keys.length !== FIELDS.length || FIELDS.some((k) => !keys.includes(k))) errors.push(`payload must have exactly the 11 fields ${FIELDS.join(", ")} (and no website)`);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(str("requestId"))) errors.push("requestId must be a lowercase UUID");
  for (const k of ["projectName", "leadName"]) if (str(k).length < 2 || str(k).length > 80) errors.push(`${k} must be 2-80 characters`);
  const email = str("email");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) errors.push("email must be a valid address of at most 160 characters");
  if (!SIZES.includes(str("size"))) errors.push(`size must be one of ${SIZES.map((s) => `"${s}"`).join(", ")}`);
  const tracks = p.tracks;
  if (!Array.isArray(tracks) || tracks.length === 0) errors.push("tracks needs at least one track id");
  else {
    const bad = tracks.filter((t) => !TRACK_IDS.includes(t));
    if (bad.length) errors.push(`unknown track id(s): ${bad.join(", ")}`);
    if (new Set(tracks).size !== tracks.length) errors.push("tracks must not repeat an id");
  }
  const addr = str("nearAddress");
  if (addr.length < 2 || addr.length > 64 || addr !== addr.toLowerCase() || !NEAR_ADDRESS.test(addr)) errors.push("nearAddress must be 2-64 lowercase characters matching the NEAR account pattern");
  if (LOCKED_ADDRESSES.includes(addr)) errors.push(`nearAddress ${addr} is the locked market contract and can never receive prizes: use your own mainnet account (DEC D-03)`);
  for (const k of ["projectUrl", "demoUrl"]) if (!isUrl(str(k)) || str(k).length > 300) errors.push(`${k} must be an http(s) URL of at most 300 characters`);
  if (str("idea").length < 20 || str("idea").length > 2000) errors.push("idea must be 20-2000 characters");
  if (typeof p.consent !== "boolean") errors.push("consent must be a boolean");
  if (Buffer.byteLength(JSON.stringify(p)) > MAX_BODY_BYTES) errors.push(`body is larger than ${MAX_BODY_BYTES} bytes`);
  return errors;
}

/** The byte count of HACKATHON.md that docs/submission/checklist.md last recorded, else the one this script was written against. */
function baseline(repo: string): { bytes: number; sha256: string | null } {
  const file = join(repo, "docs/submission/checklist.md");
  if (existsSync(file)) {
    const m = /HACKATHON\.md[^\n]*?\b(\d{2}[.,]?\d{3})\b/.exec(readFileSync(file, "utf8"));
    if (m) return { bytes: Number(m[1].replace(/[.,]/g, "")), sha256: null };
  }
  return { bytes: KNOWN_CONTRACT.bytes, sha256: KNOWN_CONTRACT.sha256 };
}

/** One request id per submission: a retry after a 503 must send the same one. Created once, mode 0600. */
function requestId(dir: string): string {
  const file = join(dir, "submission-request-id");
  if (existsSync(file)) {
    const id = readFileSync(file, "utf8").trim();
    if (id) return id;
  }
  const id = crypto.randomUUID();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(file, id + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
  return id;
}

function readInputs(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  const j: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error(`${file} must hold a JSON object`);
  return j as Record<string, unknown>;
}

const tilde = (p: string) => (p.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p);

export async function preview(flags: Flags, deps: PreviewDeps): Promise<PreviewResult> {
  const { say } = deps;
  const fail = (exit: number, errors: string[]): PreviewResult => {
    for (const e of errors) say(`ERROR ${e}`);
    return { exit, errors };
  };

  // 1. the live contract
  let doc: Uint8Array;
  try {
    const res = await deps.fetchImpl(HACKATHON_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    doc = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    return fail(1, [`cannot read ${HACKATHON_URL} (${(e as Error).message}): the contract cannot be checked, nothing was written`]);
  }
  const sha = sha256Hex(doc);
  say(`HACKATHON.md ${doc.length} bytes (sha256 ${sha.slice(0, 8)}…)`);
  const known = baseline(deps.repo);
  const changed = doc.length !== known.bytes || (known.sha256 !== null && sha !== known.sha256);
  if (changed) say(`HACKATHON.md CHANGED since ${KNOWN_CONTRACT.date} — read it before sending (recorded ${known.bytes} bytes, live ${doc.length})`);

  // 2-3. inputs: file first, flags override; a human field is never invented
  const inputsFile = join(deps.dir, "submission-inputs.json");
  let inputs: Record<string, unknown>;
  try {
    inputs = readInputs(inputsFile);
  } catch (e) {
    return fail(2, [(e as Error).message]);
  }
  const pick = (key: keyof Flags & string): unknown => flags[key] ?? inputs[key];
  const ideaFile = join(deps.repo, "docs/submission/idea.txt");
  if (!existsSync(ideaFile)) return fail(1, ["idea.txt missing (WS7-T07): docs/submission/idea.txt is the text that goes into the `idea` field"]);
  const missing = HUMAN_FIELDS.filter((k) => isBlank(pick(k)));
  if (missing.length) {
    say(`inputs: ${existsSync(inputsFile) ? tilde(inputsFile) : `${tilde(inputsFile)} (not found)`}`);
    return fail(2, [`missing human fields: ${missing.join(", ")} (write them to ${tilde(inputsFile)} or pass the flags; nothing is filled in for you)`]);
  }
  const tracksRaw = flags.tracks ?? inputs.tracks;
  const tracks = typeof tracksRaw === "string" ? tracksRaw.split(",").map((t) => t.trim()).filter(Boolean) : Array.isArray(tracksRaw) ? (tracksRaw as string[]) : DEFAULT_TRACKS;
  const text = (key: keyof Flags & string, fallback?: string) => (isBlank(pick(key)) ? fallback : (pick(key) as string));
  const payload = {
    requestId: requestId(deps.dir),
    projectName: text("projectName", DEFAULT_PROJECT_NAME),
    leadName: text("leadName"),
    email: text("email"),
    size: text("size"),
    tracks,
    nearAddress: text("nearAddress"),
    projectUrl: text("projectUrl", DEFAULT_PROJECT_URL),
    demoUrl: text("demoUrl"),
    idea: readFileSync(ideaFile, "utf8").trim(),
    // the consent field is not a stored answer: only the flag, after the human has read the notice, makes it true
    consent: flags.consent === true,
  } as Payload;

  // 4. validation
  const errors = validatePayload(payload as unknown as Record<string, unknown>);
  say(`inputs: ${existsSync(inputsFile) ? tilde(inputsFile) : "flags only"}`);
  if (inputs.q015Approved !== true) say("WARN q015Approved is not true in the inputs file: the Q-015 name check (H-19) is not confirmed");
  say(`consent notice (shown to the human before consent is given): ${CONSENT_NOTICE}`);
  if (errors.length) return { ...fail(2, errors), payload };
  if (!payload.consent) say("consent: false (the human has not agreed yet): rerun with --consent after they read the notice; the server needs true");

  // 5. written outside the repo, shown unmasked because the human has to read it
  const out = join(deps.dir, "submission.json");
  if (isInsideRepo(out)) return fail(2, [`${out} is inside the repo: refusing to write personal data there`]);
  mkdirSync(deps.dir, { recursive: true, mode: 0o700 });
  writeFileSync(out, JSON.stringify(payload, null, 2) + "\n", { mode: 0o600 });
  chmodSync(out, 0o600);
  say(JSON.stringify(payload, null, 2));
  say(`payload valid (11 fields, no website) · written ${tilde(out)} · NOT SENT`);

  // 6. the command is printed, never run
  say("send it yourself, once:");
  say("  curl -sS -X POST https://nearhackathon.com/api/applications -H 'Content-Type: application/json' -d @$HOME/.config/arrow/submission.json");
  say("  201 saved: done, never resubmit (a mistake goes through https://nearhackathon.com/request-changes)");
  say("  400 a field failed validation: fix the fields listed in the response, same requestId");
  say("  403 submissions closed or the request looked cross-site: stop and tell the agent");
  say("  409 repository already submitted or this email has 2 submissions: stop and tell the agent");
  say("  413 body too large: shorten the idea");
  say("  503 storage unavailable: wait a minute, send the same file again (same requestId)");
  return { exit: changed ? 3 : 0, payload, errors: [] };
}

export async function main(argv: string[]): Promise<number> {
  const { values: v } = parseArgs({
    args: argv,
    options: {
      dry: { type: "boolean" }, consent: { type: "boolean" }, "project-name": { type: "string" }, "lead-name": { type: "string" }, email: { type: "string" },
      size: { type: "string" }, "near-address": { type: "string" }, "project-url": { type: "string" }, "demo-url": { type: "string" }, tracks: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });
  if (v.help) {
    console.log("usage: npx tsx scripts/src/submission-preview.ts [--dry] [--consent] [--project-name <..>] [--lead-name <..>] [--email <..>] [--size <..>] [--near-address <..>] [--project-url <..>] [--demo-url <..>] [--tracks a,b,c]");
    return 0;
  }
  const r = await preview(
    { projectName: v["project-name"], leadName: v["lead-name"], email: v.email, size: v.size, nearAddress: v["near-address"], projectUrl: v["project-url"], demoUrl: v["demo-url"], tracks: v.tracks, consent: v.consent },
    { fetchImpl: fetch, dir: resolve(configDir()), repo: repoRoot(), say: (l) => console.log(l) },
  );
  return r.exit;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)).catch((e) => (console.error(mask(e instanceof Error ? e.message : String(e))), 1)));
}

