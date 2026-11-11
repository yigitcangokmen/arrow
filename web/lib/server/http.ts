// Response helpers shared by the API routes. Error bodies follow ApiError in sdk/src/schemas.ts.
export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

export function apiError(
  status: number,
  code: string,
  error: string,
  extra: { fallback?: string; detail?: string; retryAfterSec?: number } = {},
): Response {
  const { retryAfterSec, ...rest } = extra;
  return json(status, { error, code, ...rest }, retryAfterSec !== undefined ? { "retry-after": String(retryAfterSec) } : {});
}

export const rateLimited = (retryAfterSec: number) =>
  apiError(429, "RATE_LIMITED", "Too many requests. Wait and try again.", { retryAfterSec });

/**
 * Reads a JSON body of at most `max` bytes. The content-length header is not trusted: the stream is counted and cancelled
 * at the limit, so a chunked upload cannot make the route buffer more.
 */
export async function readJsonCapped(req: Request, max: number): Promise<{ tooLarge: boolean; value: unknown }> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return { tooLarge: true, value: null };
  if (!req.body) return { tooLarge: false, value: null };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return { tooLarge: true, value: null };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  try {
    return { tooLarge: false, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { tooLarge: false, value: null };
  }
}
