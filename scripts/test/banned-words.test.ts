// CI-4: the banned-word list lives in an untracked file, never in the repo, and secret-scan.sh enforces it.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

const SCAN = resolve(dirname(fileURLToPath(import.meta.url)), "../secret-scan.sh");
const WORD = "zebracorn";

let repo: string;
const git = (...args: string[]) => {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};
const commit = (file: string, text: string, msg: string) => {
  writeFileSync(join(repo, file), text);
  git("add", file);
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", msg);
};
const scan = (...args: string[]) =>
  spawnSync("bash", [SCAN, "--ci", ...args], { cwd: repo, encoding: "utf8" });
const banWord = (w: string) => {
  mkdirSync(join(repo, ".git/info"), { recursive: true });
  writeFileSync(join(repo, ".git/info/banned-words"), `# local list\n\n${w}\n`);
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "arrow-banned-"));
  git("init", "-q");
  commit("a.txt", "hello\n", "init");
});

describe("secret-scan banned words", () => {
  it("passes when there is no banned-words file", () => {
    commit("b.txt", `${WORD}\n`, "mentions the word");
    expect(scan().status).toBe(0);
  });

  it("banned_word_in_tree_fails", () => {
    banWord(WORD);
    commit("b.txt", `x ${WORD.toUpperCase()} y\n`, "add");
    const r = scan();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("b.txt:1");
    expect(r.stdout).not.toContain(WORD); // the log never repeats the word
  });

  it("banned_word_in_untracked_file_fails", () => {
    banWord(WORD);
    writeFileSync(join(repo, "new.txt"), `${WORD}\n`);
    expect(scan().status).toBe(1);
  });

  it("banned_word_only_in_history_fails_with_public", () => {
    commit("b.txt", `${WORD}\n`, "add");
    commit("b.txt", "clean\n", "remove it again");
    banWord(WORD);
    expect(scan().status).toBe(0); // the tree is clean, history is only checked on request
    const r = scan("--public");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("banned words in history");
  });

  it("banned_word_in_commit_message_fails_with_public", () => {
    commit("b.txt", "clean\n", `note ${WORD}`);
    banWord(WORD);
    expect(scan("--public").status).toBe(1);
  });

  it("passes with --public when nothing matches", () => {
    banWord(WORD);
    expect(scan("--public").status).toBe(0);
  });

  it("reads the list from a linked worktree's common git dir", () => {
    banWord(WORD);
    const wt = join(repo, "..", `${repo.split("/").pop()}-wt`);
    git("worktree", "add", "-q", wt, "-b", "other");
    writeFileSync(join(wt, "c.txt"), `${WORD}\n`);
    expect(spawnSync("bash", [SCAN, "--ci"], { cwd: wt, encoding: "utf8" }).status).toBe(1);
  });
});
