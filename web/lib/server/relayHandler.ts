// POST /api/relay logic, with every outside effect injected so tests run without a network or a key.
import { RelayRequest } from "@arrow/sdk/schemas";
import { RpcError, simulateIntents } from "@arrow/sdk/rpc";
import { ArrowViews } from "@arrow/sdk/contract";
import { type NearCaller, relayDirect } from "@arrow/sdk/relay";
import { CONTRACTS } from "../config.ts";
import { clientIp } from "../ip.ts";
import { type Limiter, limits } from "../ratelimit.ts";
import { apiError, json, rateLimited } from "./http.ts";
import { availableBalance, callerFor, escrowAccount, nearToYocto, relayerAccount, type WaitUntil } from "./near.ts";
import { type RelayValidateConfig, validateArrowMultipayload } from "./relayValidate.ts";
import { NETWORKS } from "@arrow/sdk/config";

const MIN_RELAYER_BALANCE = nearToYocto("0.05");

export interface RelayerPort {
  accountId: string;
  balance(): Promise<bigint>;
  caller(waitUntil: WaitUntil): NearCaller;
}

export interface RelayDeps {
  limiter: Limiter;
  cfg: RelayValidateConfig;
  relayer(): RelayerPort | null;
  escrowCaller(): NearCaller | null;
  paymentPath(): Promise<"notify" | "escrow">;
  simulate(multipayload: object): Promise<unknown>;
}

const SELF_RELAY =
  "send execute_intents yourself: near contract call-function as-transaction intents.near execute_intents json-args '{\"signed\":[<your multipayload>]}' prepaid-gas '600 TGas' attached-deposit '0 NEAR' sign-as <your account> network-config mainnet sign-with-keychain send";

let pathCache: { at: number; v: "notify" | "escrow" } | undefined;

export const realRelayDeps: RelayDeps = {
  limiter: limits.relay,
  cfg: { contract: CONTRACTS.mainnet, usdcToken: NETWORKS.mainnet.usdcToken },
  relayer() {
    const a = relayerAccount();
    return a && { accountId: a.accountId, balance: () => availableBalance(a), caller: (w) => callerFor(a, w) };
  },
  escrowCaller() {
    const a = escrowAccount();
    return a && callerFor(a, "FINAL");
  },
  async paymentPath() {
    if (pathCache && Date.now() - pathCache.at < 30_000) return pathCache.v;
    let v: "notify" | "escrow" = "notify"; // a contract that is not deployed yet counts as the default path
    try {
      v = (await new ArrowViews("mainnet", CONTRACTS.mainnet).version()).payment_path;
    } catch {
      // keep "notify"
    }
    pathCache = { at: Date.now(), v };
    return v;
  },
  simulate: (mp) => simulateIntents([mp], "mainnet"),
};

const unavailable = (error: string, fallback = SELF_RELAY) => apiError(503, "RELAYER_UNAVAILABLE", error, { fallback });

export async function handleRelay(req: Request, d: RelayDeps = realRelayDeps): Promise<Response> {
  const rl = d.limiter.take(clientIp(req));
  if (!rl.ok) return rateLimited(rl.retryAfterSec);

  const body = RelayRequest.safeParse(await req.json().catch(() => null));
  if (!body.success) return apiError(400, "BAD_REQUEST", "body must be {\"multipayload\": {standard, payload, signature}}");
  const mp = body.data.multipayload;

  const v = validateArrowMultipayload(mp, d.cfg);
  if (!v.ok) return apiError(v.status, v.code, v.error);

  const relayer = d.relayer();
  if (!relayer) return unavailable("The relayer is not configured on this deployment.");
  try {
    if ((await relayer.balance()) < MIN_RELAYER_BALANCE) return unavailable("The relayer is out of gas funds.");
  } catch (e) {
    return apiError(502, "RPC_ERROR", "Could not read the relayer balance.", { detail: String((e as Error).message).slice(0, 300) });
  }

  try {
    await d.simulate(mp);
  } catch (e) {
    const msg = String((e as Error).message ?? e).slice(0, 300);
    if (e instanceof RpcError && e.retryable) return apiError(502, "RPC_ERROR", "NEAR RPC is unavailable. Try again.", { detail: msg });
    return apiError(422, "SIMULATE_FAILED", "intents.near rejected the signed intent in simulation.", { detail: msg });
  }

  const escrow = v.op !== "list" && (await d.paymentPath()) === "escrow";
  const escrowCaller = escrow ? d.escrowCaller() : null;
  if (escrow && !escrowCaller) return unavailable("The relayer cannot request the evaluation.", "escrow request key not configured");

  try {
    const r = await relayDirect(
      relayer.caller(escrow ? "FINAL" : "INCLUDED_FINAL"),
      mp,
      escrowCaller ? { caller: escrowCaller, contractId: d.cfg.contract } : undefined,
    );
    return json(200, r);
  } catch (e) {
    return apiError(502, "RPC_ERROR", "The relayer transaction failed.", { detail: String((e as Error).message ?? e).slice(0, 300) });
  }
}
