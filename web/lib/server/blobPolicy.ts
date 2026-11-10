// What a Blob client token may do (DEC L-04): one content-addressed path, bounded size, no overwrite.
import { MAX_BLOB_BYTES } from "@arrow/sdk/flows";

export class BlobPolicyError extends Error {
  constructor(public readonly code: "BAD_PATH" | "TOO_LARGE" | "QUOTA" | "STORE_UNAVAILABLE", message: string) {
    super(message);
    this.name = "BlobPolicyError";
  }
}

const PATH = /^blobs\/([0-9a-f]{64})\.bin$/;

/** A client token lives five minutes: long enough for a 5 MB upload, too short to hand around (the library default is an hour). */
export const TOKEN_TTL_MS = 5 * 60_000;

/** `clientPayload` is the JSON `{"sha256","size"}` the page sends with upload(). Throws BlobPolicyError. */
export function tokenOptionsFor(pathname: string, clientPayload: string | null, now: number = Date.now()) {
  const m = PATH.exec(pathname);
  if (!m) throw new BlobPolicyError("BAD_PATH", "pathname must be blobs/<sha256>.bin (lowercase hex)");
  let payload: { sha256?: unknown; size?: unknown };
  try {
    payload = JSON.parse(clientPayload ?? "");
  } catch {
    throw new BlobPolicyError("BAD_PATH", "clientPayload must be JSON {\"sha256\",\"size\"}");
  }
  if (payload?.sha256 !== m[1]) throw new BlobPolicyError("BAD_PATH", "pathname does not match the declared sha256");
  if (typeof payload.size !== "number" || !Number.isInteger(payload.size) || payload.size < 1 || payload.size > MAX_BLOB_BYTES) {
    throw new BlobPolicyError("TOO_LARGE", `size must be 1..${MAX_BLOB_BYTES} bytes`);
  }
  return {
    allowedContentTypes: ["application/octet-stream"],
    maximumSizeInBytes: MAX_BLOB_BYTES,
    addRandomSuffix: false,
    allowOverwrite: false,
    cacheControlMaxAge: 31_536_000,
    validUntil: now + TOKEN_TTL_MS,
  };
}

/** The store may hold this much, and take this much in 24 hours, across all instances (read from the store itself). */
export const STORE_CAP_BYTES = 400 * 1024 * 1024;
export const DAY_CAP_BYTES = 100 * 1024 * 1024;

export interface StoreUsage {
  totalBytes: number;
  last24hBytes: number;
}

/** Throws QUOTA when a new upload of `size` bytes would pass either cap. */
export function checkQuota(u: StoreUsage, size: number): void {
  if (u.totalBytes + size > STORE_CAP_BYTES) throw new BlobPolicyError("QUOTA", "The blob store is full. Host the encrypted file yourself.");
  if (u.last24hBytes + size > DAY_CAP_BYTES) throw new BlobPolicyError("QUOTA", "The hosted upload limit for today is used up. Host the encrypted file yourself.");
}
