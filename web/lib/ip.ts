/**
 * The client address for rate limits: the first x-forwarded-for hop, else x-real-ip. Vercel overwrites both, so they are
 * read only there (or when ARROW_TRUST_PROXY=1 says a proxy you control does the same). Anywhere else a caller could rotate
 * the header to dodge every limit, so all requests share the "unknown" key. They are used for nothing but rate limits.
 */
export function clientIp(req: Request, env: Record<string, string | undefined> = process.env): string {
  if (!env.VERCEL && env.ARROW_TRUST_PROXY !== "1") return "unknown";
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || req.headers.get("x-real-ip")?.trim() || "unknown";
}
