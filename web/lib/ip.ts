/** First x-forwarded-for hop, else x-real-ip, else "unknown". Vercel sets these; they are not trusted for anything but rate limits. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || req.headers.get("x-real-ip")?.trim() || "unknown";
}
