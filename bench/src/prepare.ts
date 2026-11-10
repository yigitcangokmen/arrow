// npm run bench:prepare [-- --copy-web <id,id,...>]   (WS6-T05)
// Encrypts the 49 bench plaintexts (room 26 + leak 3 + quality 20) with a fresh XChaCha key each, writes
// bench/blobs/<sha>.bin + manifest.json and stores the keys OUTSIDE the repo (~/.config/arrow/bench-keys.json, 0600).
// The plaintexts are public in the repo, the keys only keep the listing flow honest. A second run reuses every
// blob whose plaintext is unchanged and whose key is still on this machine.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encryptFile, sha256Hex } from "@arrow/sdk";
import { benchCases } from "./native.ts";
import { defaultKeysPath, loadBenchK, say, short, storeBenchK } from "./keys.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export type ManifestEntry = { dataset_id: string; path: string; sha256: string; bytes: number; plaintext_path: string; plaintext_sha256: string; created_at_utc: string };

export function prepareBlobs(o: { root?: string; keysPath?: string; now?: Date } = {}): { entries: ManifestEntry[]; reused: number; created: number } {
  const out = o.root ?? ROOT;
  const keysPath = o.keysPath ?? defaultKeysPath();
  const manifestPath = resolve(out, "bench/blobs/manifest.json");
  const old: ManifestEntry[] = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : [];
  const entries: ManifestEntry[] = [];
  let reused = 0, created = 0;
  mkdirSync(resolve(out, "bench/blobs"), { recursive: true });
  for (const c of benchCases()) {
    const plain = readFileSync(resolve(ROOT, c.data));
    const psha = sha256Hex(new Uint8Array(plain));
    const prev = old.find((e) => e.dataset_id === c.id && e.plaintext_sha256 === psha && e.plaintext_path === c.data);
    if (prev && existsSync(resolve(out, prev.path))) {
      try { loadBenchK(prev.sha256, keysPath); entries.push(prev); reused++; continue; } catch { /* key lost: encrypt again */ }
    }
    const enc = encryptFile(new Uint8Array(plain));
    writeFileSync(resolve(out, `bench/blobs/${enc.blobSha256}.bin`), enc.blob);
    storeBenchK(enc.blobSha256, enc.key, keysPath);
    enc.key.fill(0);
    entries.push({ dataset_id: c.id, path: `bench/blobs/${enc.blobSha256}.bin`, sha256: enc.blobSha256, bytes: enc.blob.length, plaintext_path: c.data, plaintext_sha256: psha, created_at_utc: (o.now ?? new Date()).toISOString().slice(0, 19) + "Z" });
    created++;
  }
  entries.sort((a, b) => a.dataset_id.localeCompare(b.dataset_id));
  writeFileSync(manifestPath, JSON.stringify(entries, null, 2) + "\n");
  return { entries, reused, created };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const r = prepareBlobs();
  say(`prepared ${r.entries.length} blobs (${r.created} new, ${r.reused} reused) → bench/blobs (manifest.json), keys → ~/.config/arrow/bench-keys.json (0600)`);
  const args = process.argv.slice(2);
  if (args.includes("--copy-web")) {
    for (const id of args[args.indexOf("--copy-web") + 1]!.split(",")) {
      const e = r.entries.find((x) => x.dataset_id === id);
      if (!e) throw new Error(`no blob for ${id}`);
      mkdirSync(resolve(ROOT, "web/public/bench-blobs"), { recursive: true });
      copyFileSync(resolve(ROOT, e.path), resolve(ROOT, `web/public/bench-blobs/${e.sha256}.bin`));
      say(`copied ${id} → web/public/bench-blobs/${short(e.sha256)}....bin`);
    }
  }
}
