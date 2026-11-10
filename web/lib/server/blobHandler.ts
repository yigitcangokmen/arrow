import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { list } from "@vercel/blob";
import { clientIp } from "../ip.ts";
import { type Limiter, limits } from "../ratelimit.ts";
import { BlobPolicyError, checkQuota, type StoreUsage, tokenOptionsFor } from "./blobPolicy.ts";
import { apiError, json, rateLimited, readJsonCapped } from "./http.ts";
import { sameSiteJson } from "./origin.ts";

export interface BlobDeps {
  limiter: Limiter;
  token(): string | undefined;
  upload: typeof handleUpload;
  /** What the store holds now. It is read from the store, so the cap holds across serverless instances. */
  usage(token: string): Promise<StoreUsage>;
}

async function storeUsage(token: string): Promise<StoreUsage> {
  let totalBytes = 0;
  let last24hBytes = 0;
  const since = Date.now() - 86_400_000;
  let cursor: string | undefined;
  do {
    const page = await list({ token, prefix: "blobs/", limit: 1000, cursor });
    for (const b of page.blobs) {
      totalBytes += b.size;
      if (b.uploadedAt.getTime() >= since) last24hBytes += b.size;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return { totalBytes, last24hBytes };
}

export const realBlobDeps: BlobDeps = {
  limiter: limits.blob,
  token: () => process.env.BLOB_READ_WRITE_TOKEN,
  upload: handleUpload,
  usage: storeUsage,
};

const MAX_BODY_BYTES = 16 * 1024;

export async function handleBlobPost(req: Request, d: BlobDeps = realBlobDeps): Promise<Response> {
  const rl = d.limiter.take(clientIp(req));
  if (!rl.ok) return rateLimited(rl.retryAfterSec);
  const foreign = sameSiteJson(req);
  if (foreign) return foreign;

  const token = d.token();
  if (!token) {
    return apiError(503, "BLOB_NOT_CONFIGURED", "Blob storage is not configured on this deployment.", {
      fallback: "host the .bin yourself and paste its https URL",
    });
  }
  const read = await readJsonCapped(req, MAX_BODY_BYTES);
  if (read.tooLarge) return apiError(413, "TOO_LARGE", "The request body is too large.");
  const body = read.value as HandleUploadBody | null;
  if (!body || typeof body !== "object") return apiError(400, "BAD_REQUEST", "body must be the JSON that @vercel/blob/client upload() sends");

  try {
    // onUploadCompleted is left out on purpose: the path is already the content hash (DEC L-04). Hashing the bytes would not
    // limit abuse anyway (anyone can name their own bytes by their own sha), so the limits are size, a five minute token and the store caps.
    const out = await d.upload({
      token,
      request: req,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const options = tokenOptionsFor(pathname, clientPayload);
        const size = (JSON.parse(clientPayload ?? "{}") as { size: number }).size;
        let usage: StoreUsage;
        try {
          usage = await d.usage(token);
        } catch {
          throw new BlobPolicyError("STORE_UNAVAILABLE", "Could not check the blob store. Host the encrypted file yourself.");
        }
        checkQuota(usage, size);
        return options;
      },
    });
    return json(200, out);
  } catch (e) {
    if (e instanceof BlobPolicyError) {
      const status = e.code === "TOO_LARGE" ? 413 : e.code === "QUOTA" ? 429 : e.code === "STORE_UNAVAILABLE" ? 503 : 400;
      return apiError(status, e.code, e.message, status >= 429 ? { fallback: "host the .bin yourself and paste its https URL" } : {});
    }
    return apiError(400, "BAD_REQUEST", "The upload request was refused.");
  }
}
