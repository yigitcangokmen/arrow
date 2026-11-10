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

export const rateLimited = (retryAfterSec: number, code = "RATE_LIMITED") =>
  apiError(429, code, "Too many requests. Wait and try again.", { retryAfterSec });
