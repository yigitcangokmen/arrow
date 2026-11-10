import type { Label, Row } from "../types.ts";

export const row = (id: string, label: Label, required: boolean, title: string, detail: string, links: string[] = []): Row => ({
  id, label, required, title, detail, links,
});

export const lc = (s: unknown): string => (typeof s === "string" ? s.toLowerCase() : "");

/** Text of a thrown value for a row detail. */
export const why = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 200);
