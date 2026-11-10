// Test-only decoder for the intents.near versioned nonce. The last 27 bytes are salt (4), deadline (u64 LE, ns) and
// the 15 random bytes; whatever version prefix comes before them is ignored.
export function decodeNonce(b64: string): { salt: Uint8Array; deadlineMs: number; random: Uint8Array } {
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const body = raw.subarray(raw.length - 27);
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return { salt: body.subarray(0, 4), deadlineMs: Number(dv.getBigUint64(4, true) / 1_000_000n), random: body.subarray(12, 27) };
}
