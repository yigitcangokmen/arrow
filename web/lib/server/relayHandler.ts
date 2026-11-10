// POST /api/relay logic, with every outside effect injected so tests run without a network or a key.
import { createHash } from "node:crypto";
import { type Listing, RelayRequest } from "@arrow/sdk/schemas";
import { RpcError, simulateIntents } from "@arrow/sdk/rpc";
import { ArrowViews } from "@arrow/sdk/contract";
import { type NearCaller, relayDirect } from "@arrow/sdk/relay";
import { CONTRACTS } from "../config.ts";
import { clientIp } from "../ip.ts";
import { type Limiter, limits, tokenBucket } from "../ratelimit.ts";
import { apiError, json, rateLimited } from "./http.ts";
import { availableBalance, callerFor, escrowAccount, nearErrorMessage, nearToYocto, relayerAccount, type WaitUntil } from "./near.ts";
import { RelayRuns, type Snap } from "./relayRuns.ts";
import { type RelayValidateConfig, validateArrowMultipayload } from "./relayValidate.ts";
import { NETWORKS } from "@arrow/sdk/config";

const MIN_RELAYER_BALANCE = nearToYocto("0.05");

export interface RelayerPort {
  accountId: string;
  balance(): Promise<bigint>;
  caller(waitUntil: WaitUntil): NearCaller;
}

/** The two reads of the market contract that decide whether a payment can succeed. */
export interface ChainPort {
  listing(id: number): Promise<Listing | null>;
  /** get_config().config.listing_bond, USDC base units. */
  listingBond(): Promise<bigint>;
}

export interface RelayDeps {
  limiter: Limiter;
  /** Per signed-in EVM address, taken only for a payload this instance has not seen (a replay costs the relayer nothing). */
  signerLimiter: Limiter;
  store: RelayRuns;
  chain: ChainPort;
  /** How long one request waits for the relayer before it answers RELAY_UNCLEAR; the route's maxDuration is 60 s. */
  waitMs: number;
  cfg: RelayValidateConfig;
  relayer(): RelayerPort | null;
  escrowCaller(): NearCaller | null;
  paymentPath(): Promise<"notify" | "escrow">;
  simulate(multipayload: object): Promise<unknown>;
}

const SELF_RELAY =
  "send execute_intents yourself: near contract call-function as-transaction intents.near execute_intents json-args '{\"signed\":[<your multipayload>]}' prepaid-gas '600 TGas' attached-deposit '0 NEAR' sign-as <your account> network-config mainnet sign-with-keychain send";

let pathCache: { at: number; v: "notify" | "escrow" } | undefined;

const mainnetViews = () => new ArrowViews("mainnet", CONTRACTS.mainnet);

export const realRelayDeps: RelayDeps = {
  limiter: limits.relay,
  signerLimiter: tokenBucket({ capacity: 5, refillEveryMs: 30_000 }), // a session needs about 3 payments; one signer cannot drain the gas tank
  store: new RelayRuns(),
  waitMs: 50_000,
  chain: {
    listing: (id) => mainnetViews().listing(id),
    async listingBond() {
      const bond = (await mainnetViews().config()).config.listing_bond;
      if (typeof bond !== "string" || !/^\d+$/.test(bond)) throw new Error("get_config has no listing_bond");
      return BigInt(bond);
    },
  },
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

const snap = async (r: Response): Promise<Snap> => ({ status: r.status, body: await r.text(), headers: Object.fromEntries(r.headers) });
const respond = (s: Snap) => new Response(s.body, { status: s.status, headers: s.headers });

/** The transaction may have been broadcast but nobody confirmed it: not a payment failure, and not safe to pay again blindly. */
const unclear = async (detail?: string): Promise<Snap> =>
  snap(
    json(502, {
      error: "Your payment may or may not have gone through: the relayer could not confirm it. Do not pay again yet. Check your NEAR Intents balance and your Arrow activity first.",
      code: "RELAY_UNCLEAR",
      unclear: true,
      ...(detail ? { detail } : {}),
    }),
  );

const NONCE_USED = /nonce.*(used|already)|already.*used/i;

/** amount and listing against the contract's own rules (E07, E08, E09), so a payment that would panic costs no gas. */
async function checkAgainstChain(v: Extract<ReturnType<typeof validateArrowMultipayload>, { ok: true }>, chain: ChainPort): Promise<Response | null> {
  const low = (what: string, need: bigint) => apiError(400, "AMOUNT_TOO_LOW", `The payment is ${v.amount} base units but ${what} is ${need}.`);
  try {
    if (v.op === "list") {
      const bond = await chain.listingBond();
      return v.amount < bond ? low("the listing bond", bond) : null;
    }
    const l = await chain.listing(v.listingId!);
    if (!l) return apiError(404, "LISTING_NOT_FOUND", `Listing ${v.listingId} does not exist.`);
    if (v.op === "eval") {
      if (v.amount < BigInt(l.eval_fee)) return low("the eval fee", BigInt(l.eval_fee));
      if (l.evals_used >= l.max_evals) return apiError(409, "BUDGET_EXHAUSTED", "This listing's inspection budget is used up: it is buy-only.");
      return null;
    }
    return v.amount < BigInt(l.price) ? low("the price", BigInt(l.price)) : null;
  } catch (e) {
    return apiError(502, "RPC_ERROR", "Could not read the market contract. Nothing was sent; try again.", { detail: nearErrorMessage(e).slice(0, 300) });
  }
}

export async function handleRelay(req: Request, d: RelayDeps = realRelayDeps): Promise<Response> {
  const rl = d.limiter.take(clientIp(req));
  if (!rl.ok) return rateLimited(rl.retryAfterSec);

  const body = RelayRequest.safeParse(await req.json().catch(() => null));
  if (!body.success) return apiError(400, "BAD_REQUEST", "body must be {\"multipayload\": {standard, payload, signature}}");
  const mp = body.data.multipayload;

  const v = validateArrowMultipayload(mp, d.cfg);
  if (!v.ok) return apiError(v.status, v.code, v.error);

  // The same signed payload (RELAY-3) is run once; a repeat gets the stored answer, a concurrent twin shares the run.
  const key = createHash("sha256").update(mp.payload).update("\n").update(mp.signature).digest("hex");
  const answer = await d.store.run(
    key,
    async () => {
      const s = await relay(mp, v, d);
      return { snap: await snap(s.res), keep: s.broadcast };
    },
    d.waitMs,
    await unclear(),
  );
  return respond(answer);
}

async function relay(mp: Parameters<typeof relayDirect>[1], v: Extract<ReturnType<typeof validateArrowMultipayload>, { ok: true }>, d: RelayDeps): Promise<{ res: Response; broadcast: boolean }> {
  const before = (res: Response) => ({ res, broadcast: false });

  const sl = d.signerLimiter.take(v.signerId);
  if (!sl.ok) return before(rateLimited(sl.retryAfterSec));
  const refused = await checkAgainstChain(v, d.chain);
  if (refused) return before(refused);

  const relayer = d.relayer();
  if (!relayer) return before(unavailable("The relayer is not configured on this deployment."));
  try {
    if ((await relayer.balance()) < MIN_RELAYER_BALANCE) return before(unavailable("The relayer is out of gas funds."));
  } catch (e) {
    return before(apiError(502, "RPC_ERROR", "Could not read the relayer balance.", { detail: nearErrorMessage(e).slice(0, 300) }));
  }

  try {
    await d.simulate(mp);
  } catch (e) {
    const msg = String((e as Error).message ?? e).slice(0, 300);
    if (e instanceof RpcError && e.retryable) return before(apiError(502, "RPC_ERROR", "NEAR RPC is unavailable. Try again.", { detail: msg }));
    if (NONCE_USED.test(msg)) {
      return before(apiError(409, "ALREADY_RELAYED", "This exact signed payment was already submitted to NEAR Intents. Do not pay again: check your NEAR Intents balance and your Arrow activity.", { detail: msg }));
    }
    return before(apiError(422, "SIMULATE_FAILED", "intents.near rejected the signed intent in simulation.", { detail: msg }));
  }

  const escrow = v.op !== "list" && (await d.paymentPath()) === "escrow";
  const escrowCaller = escrow ? d.escrowCaller() : null;
  if (escrow && !escrowCaller) return before(unavailable("The relayer cannot request the evaluation.", "escrow request key not configured"));

  try {
    const r = await relayDirect(
      relayer.caller(escrow ? "FINAL" : "INCLUDED_FINAL"),
      mp,
      escrowCaller ? { caller: escrowCaller, contractId: d.cfg.contract } : undefined,
    );
    return { res: json(200, r), broadcast: true };
  } catch (e) {
    // From here the transaction may be on chain (a timeout says nothing), so this is not reported as a failed payment.
    return { res: respond(await unclear(nearErrorMessage(e).slice(0, 300))), broadcast: true };
  }
}
