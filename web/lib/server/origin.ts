// Browser-only POST routes (/api/blob, /api/testnet-sponsor) take JSON from this site's own pages. A cross-site form can only
// send "simple" requests (text/plain and friends), and always carries an Origin, so both are checked.
import { apiError } from "./http.ts";

export function sameSiteJson(req: Request, env: Record<string, string | undefined> = process.env): Response | null {
  if (!/^application\/json\s*(;|$)/i.test(req.headers.get("content-type") ?? "")) {
    return apiError(415, "UNSUPPORTED_MEDIA_TYPE", "Send application/json.");
  }
  const origin = req.headers.get("origin");
  if (origin) {
    let host = "";
    try {
      host = new URL(origin).host;
    } catch {
      // stays empty and fails below
    }
    const allowed = [env.NEXT_PUBLIC_SITE_DOMAIN, req.headers.get("host")].filter(Boolean);
    if (!allowed.includes(host)) return apiError(403, "FOREIGN_ORIGIN", "This route only accepts requests from Arrow's own pages.");
  }
  return null;
}
