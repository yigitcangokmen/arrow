// What a Blob client token may do (DEC L-04): one content-addressed path, bounded size, no overwrite.
import { MAX_BLOB_BYTES } from "@arrow/sdk/flows";

export class BlobPolicyError extends Error {
  constructor(public readonly code: "BAD_PATH" | "TOO_LARGE", message: string) {
    super(message);
    this.name = "BlobPolicyError";
  }
}

const PATH = /^blobs\/([0-9a-f]{64})\.bin$/;

/** `clientPayload` is the JSON `{"sha256","size"}` the page sends with upload(). Throws BlobPolicyError. */
export function tokenOptionsFor(pathname: string, clientPayload: string | null) {
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
  };
}
