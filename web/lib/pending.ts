// What the browser must remember between "signed" and "result delivered" (RELAY-3, reload recovery).
// Two small stores over localStorage, both optional: when storage is blocked the page still works, it just cannot resume.
import type { MultiPayload } from "@arrow/sdk/schemas";
import type { Network } from "./config.ts";

export interface StoragePort {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** localStorage when it works, else a Map that lives as long as the tab. */
export function browserStorage(): StoragePort {
  try {
    const s = window.localStorage;
    s.setItem("arrow:probe", "1");
    s.removeItem("arrow:probe");
    return s;
  } catch {
    return memoryStorage();
  }
}

export function memoryStorage(): StoragePort {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

export type PayKind = "list" | "eval" | "buy";

/** A signed payment whose relay answer is not known. The signature is the money: it is re-sent byte for byte, never replaced. */
export interface PendingPayment {
  v: 1;
  kind: PayKind;
  listingId: number | null;
  /** The payer's Intents account (lowercase 0x). */
  signerId: string;
  amount: string;
  multipayload: MultiPayload;
  /** Intent deadline (ms epoch) and nonce, read out of the signed payload. */
  deadlineMs: number;
  nonce: string;
  createdAt: number;
  meta?: PayMeta;
}

/** What the page needs again to show the result after a reload. */
export interface PayMeta {
  /** The buyer gave a list of their own, so novelty was measured. */
  hadList?: boolean;
}

const pendingKey = (n: Network, signer: string) => `arrow:pending-pay:v1:${n}:${signer.toLowerCase()}`;

function read<T>(s: StoragePort, key: string): T | null {
  try {
    const raw = s.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}
function write(s: StoragePort, key: string, v: unknown): void {
  try {
    s.setItem(key, JSON.stringify(v));
  } catch {
    // quota or blocked storage: resume is lost, payment safety inside this tab is not
  }
}

export interface PendingStore {
  get(network: Network, signer: string): PendingPayment | null;
  put(network: Network, p: PendingPayment): void;
  clear(network: Network, signer: string): void;
}

export const pendingStore = (s: StoragePort): PendingStore => ({
  get: (n, signer) => {
    const p = read<PendingPayment>(s, pendingKey(n, signer));
    return p && p.v === 1 && typeof p.multipayload?.payload === "string" ? p : null;
  },
  put: (n, p) => write(s, pendingKey(n, p.signerId), p),
  clear: (n, signer) => {
    try {
      s.removeItem(pendingKey(n, signer));
    } catch {
      // nothing to clear
    }
  },
});

/** A payment the relay accepted: enough to find the result again after a reload. */
export interface PaidRecord {
  v: 1;
  kind: PayKind;
  listingId: number;
  tx: { txHash: string; signerId: string } | null;
  /** The id the contract assigned, once known (eval_id, purchase_id or listing_id). */
  resultId: number | null;
  at: number;
  meta?: PayMeta;
}

const historyKey = (n: Network, signer: string) => `arrow:paid:v1:${n}:${signer.toLowerCase()}`;
const HISTORY_MAX = 30;

export interface HistoryStore {
  list(network: Network, signer: string, listingId: number): PaidRecord[];
  add(network: Network, signer: string, r: PaidRecord): void;
  /** `at` identifies the record (the time it was added). */
  setResultId(network: Network, signer: string, at: number, resultId: number): void;
}

export const historyStore = (s: StoragePort): HistoryStore => {
  const all = (n: Network, signer: string) => {
    const v = read<PaidRecord[]>(s, historyKey(n, signer));
    return Array.isArray(v) ? v.filter((r) => r?.v === 1) : [];
  };
  return {
    list: (n, signer, listingId) => all(n, signer).filter((r) => r.listingId === listingId),
    add(n, signer, r) {
      write(s, historyKey(n, signer), [...all(n, signer), r].slice(-HISTORY_MAX));
    },
    setResultId(n, signer, at, resultId) {
      write(s, historyKey(n, signer), all(n, signer).map((r) => (r.at === at ? { ...r, resultId } : r)));
    },
  };
};
