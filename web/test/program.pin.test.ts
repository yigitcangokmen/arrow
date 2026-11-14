// D1 fallback: the site serves the frozen program bytes at /program/<sha>.wasm, a second URL for set_program.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { config } from "../proxy.ts";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FROZEN = "6ad7fed42691279cbcb43c3e8599fa0ef70ed7c54669e954b5acb31c03e1abc1";
const sha256 = (p: string) => createHash("sha256").update(readFileSync(resolve(repo, p))).digest("hex");

describe("D1 fallback: hosted program bytes", () => {
  it("the served wasm is the frozen release program", () => {
    expect(readFileSync(resolve(repo, "release/sha256.txt"), "utf8").trim().split(/\s+/)[0]).toBe(FROZEN);
    expect(sha256(`web/public/program/${FROZEN}.wasm`)).toBe(FROZEN);
    expect(sha256("release/arrow-tee.wasm")).toBe(FROZEN);
  });

  it("the proxy leaves /program alone and still covers the pages", () => {
    const pages = new RegExp(`^${config.matcher[0]!.source}$`);
    expect(pages.test(`/program/${FROZEN}.wasm`)).toBe(false);
    expect(pages.test("/buy/1")).toBe(true);
  });
});
