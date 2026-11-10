import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { clientIp } from "../ip.ts";
import { type Limiter, limits } from "../ratelimit.ts";
import { BlobPolicyError, tokenOptionsFor } from "./blobPolicy.ts";
import { apiError, json, rateLimited } from "./http.ts";

export interface BlobDeps {
  limiter: Limiter;
  token(): string | undefined;
  upload: typeof handleUpload;
}

export const realBlobDeps: BlobDeps = {
  limiter: limits.blob,
  token: () => process.env.BLOB_READ_WRITE_TOKEN,
  upload: handleUpload,
};

export async function handleBlobPost(req: Request, d: BlobDeps = realBlobDeps): Promise<Response> {
  const rl = d.limiter.take(clientIp(req));
  if (!rl.ok) return rateLimited(rl.retryAfterSec);

  const token = d.token();
  if (!token) {
    return apiError(503, "BLOB_NOT_CONFIGURED", "Blob storage is not configured on this deployment.", {
      fallback: "host the .bin yourself and paste its https URL",
    });
  }
  const body = (await req.json().catch(() => null)) as HandleUploadBody | null;
  if (!body || typeof body !== "object") return apiError(400, "BAD_REQUEST", "body must be the JSON that @vercel/blob/client upload() sends");

  try {
    // onUploadCompleted is left out on purpose: the path is already the content hash (DEC L-04).
    const out = await d.upload({ token, request: req, body, onBeforeGenerateToken: async (pathname, clientPayload) => tokenOptionsFor(pathname, clientPayload) });
    return json(200, out);
  } catch (e) {
    if (e instanceof BlobPolicyError) return apiError(e.code === "TOO_LARGE" ? 413 : 400, e.code, e.message);
    return apiError(400, "BAD_REQUEST", "The upload request was refused.");
  }
}
