// The live NEAR AI attestation line on /verify. It is the endpoint's state now, never the state at eval time, so the
// label is always NOT PROVEN (DEC O-03).
export interface NearAiLine {
  label: "NOT PROVEN";
  text: string;
  signingAddress: string | null;
}

export const CAVEAT = "current endpoint state, not eval-time";

export async function fetchNearAiLine(urlPrefix: string, fetchImpl: typeof fetch, now: Date): Promise<NearAiLine> {
  const at = `${now.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    const res = await fetchImpl(`${urlPrefix}&nonce=${nonce}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return { label: "NOT PROVEN", signingAddress: null, text: `NEAR AI endpoint attestation: unavailable (HTTP ${res.status}); ${CAVEAT}` };
    const body: any = await res.json();
    const addr = body?.gateway_attestation?.signing_address;
    const signingAddress = typeof addr === "string" ? addr : null;
    return { label: "NOT PROVEN", signingAddress, text: `NEAR AI endpoint attestation: ${CAVEAT} (fetched ${at})${signingAddress ? `; gateway signing address ${signingAddress}` : ""}` };
  } catch {
    return { label: "NOT PROVEN", signingAddress: null, text: `NEAR AI endpoint attestation: unavailable; ${CAVEAT}` };
  }
}
