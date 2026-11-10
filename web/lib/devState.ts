export type DevState = "loading" | "empty" | "error";

/** `?state=loading|empty|error` forces a UI state in development only (T11 uses it next to the real triggers). */
export function devState(search: string | URLSearchParams | undefined): DevState | null {
  if (process.env.NODE_ENV === "production") return null;
  const v = new URLSearchParams(search).get("state");
  return v === "loading" || v === "empty" || v === "error" ? v : null;
}
