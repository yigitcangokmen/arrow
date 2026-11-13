// Tells a busy RPC (rate limit, 5xx, timeout, network) apart from a real answer such as a contract that is not deployed.

/** True when an RPC error message is the endpoint's load, not the call's result: the page should wait and retry, not report a fault. */
export function rpcBusy(message: string): boolean {
  return /HTTP (429|5\d\d)|-429|rate.?limit|too many requests|timeout|timed out|fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|aborted/i.test(message);
}
