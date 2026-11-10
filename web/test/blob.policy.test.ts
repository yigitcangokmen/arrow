import { describe, expect, it, vi } from "vitest";
import { MAX_BLOB_BYTES } from "@arrow/sdk/flows";
import { BlobPolicyError, tokenOptionsFor } from "../lib/server/blobPolicy.ts";
import { handleBlobPost } from "../lib/server/blobHandler.ts";
import { tokenBucket } from "../lib/ratelimit.ts";
import { post } from "./helpers.ts";

const H = "ab".repeat(32);
const payload = (o: object = {}) => JSON.stringify({ sha256: H, size: 1000, ...o });
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof BlobPolicyError ? e.code : "OTHER";
  }
  return "NONE";
};

describe("tokenOptionsFor", () => {
  it("allows blobs/<sha256>.bin with a matching payload", () => {
    expect(tokenOptionsFor(`blobs/${H}.bin`, payload())).toEqual({
      allowedContentTypes: ["application/octet-stream"],
      maximumSizeInBytes: MAX_BLOB_BYTES,
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 31_536_000,
    });
    expect(code(() => tokenOptionsFor(`blobs/${H}.bin`, payload({ size: MAX_BLOB_BYTES })))).toBe("NONE");
  });

  it("refuses other paths", () => {
    expect(code(() => tokenOptionsFor("blobs/../x", payload()))).toBe("BAD_PATH");
    expect(code(() => tokenOptionsFor(`blobs/${H.toUpperCase()}.bin`, payload({ sha256: H.toUpperCase() })))).toBe("BAD_PATH");
    expect(code(() => tokenOptionsFor(`other/${H}.bin`, payload()))).toBe("BAD_PATH");
    expect(code(() => tokenOptionsFor(`blobs/${H}.bin/extra`, payload()))).toBe("BAD_PATH");
  });

  it("refuses a payload that does not match the path or is not JSON", () => {
    expect(code(() => tokenOptionsFor(`blobs/${H}.bin`, payload({ sha256: "cd".repeat(32) })))).toBe("BAD_PATH");
    expect(code(() => tokenOptionsFor(`blobs/${H}.bin`, "not json"))).toBe("BAD_PATH");
    expect(code(() => tokenOptionsFor(`blobs/${H}.bin`, null))).toBe("BAD_PATH");
  });

  it("refuses a size above the limit, zero or not an integer", () => {
    expect(code(() => tokenOptionsFor(`blobs/${H}.bin`, payload({ size: MAX_BLOB_BYTES + 1 })))).toBe("TOO_LARGE");
    expect(code(() => tokenOptionsFor(`blobs/${H}.bin`, payload({ size: 0 })))).toBe("TOO_LARGE");
    expect(code(() => tokenOptionsFor(`blobs/${H}.bin`, payload({ size: "9" })))).toBe("TOO_LARGE");
  });
});

describe("POST /api/blob", () => {
  const body = (o: object = {}) => ({ type: "blob.generate-client-token", payload: { pathname: `blobs/${H}.bin`, multipart: false, clientPayload: payload(o) } });
  const deps = (token: string | undefined, upload = vi.fn()) => ({ limiter: tokenBucket({ capacity: 10, refillEveryMs: 360_000 }), token: () => token, upload: upload as any });

  it("503 BLOB_NOT_CONFIGURED with the self-host fallback when the token is missing", async () => {
    const res = await handleBlobPost(post("http://localhost/api/blob", body()), deps(undefined));
    expect(res.status).toBe(503);
    const b = await res.json();
    expect(b.code).toBe("BLOB_NOT_CONFIGURED");
    expect(b.fallback).toBe("host the .bin yourself and paste its https URL");
  });

  it("passes only policy-checked options to handleUpload and returns its JSON", async () => {
    const upload = vi.fn(async (o: any) => ({ type: "blob.generate-client-token", clientToken: "tok", opts: await o.onBeforeGenerateToken(o.body.payload.pathname, o.body.payload.clientPayload, false) }));
    const res = await handleBlobPost(post("http://localhost/api/blob", body()), deps("rw_token", upload as any));
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.clientToken).toBe("tok");
    expect(b.opts.maximumSizeInBytes).toBe(MAX_BLOB_BYTES);
    expect(upload.mock.calls[0][0].onUploadCompleted).toBeUndefined();
  });

  it("413 TOO_LARGE and 400 BAD_PATH come from the policy", async () => {
    const real = (o: any) => o.onBeforeGenerateToken(o.body.payload.pathname, o.body.payload.clientPayload, false);
    expect((await handleBlobPost(post("http://localhost/api/blob", body({ size: MAX_BLOB_BYTES + 1 })), deps("t", real as any))).status).toBe(413);
    expect((await handleBlobPost(post("http://localhost/api/blob", body({ sha256: "cd".repeat(32) })), deps("t", real as any))).status).toBe(400);
  });

  it("429 after 10 requests", async () => {
    const d = deps("t", vi.fn(async () => ({ type: "blob.generate-client-token", clientToken: "x" })) as any);
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await handleBlobPost(post("http://localhost/api/blob", body()), d)).status);
    expect(codes.at(-1)).toBe(429);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
  });
});
