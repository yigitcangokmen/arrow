// POST /api/relay logic, with every outside effect injected so tests run without a network or a key.
import { createHash } from "node:crypto";
import { type Listing, RelayRequest } from "@arrow/sdk/schemas";
import { RpcError, simulateIntents } from "@arrow/sdk/rpc";
import { ArrowViews } from "@arrow/sdk/contract";
import { type NearCaller, relayDirect } from "@arrow/sdk/relay";
import { CONTRACTS } from "../config.ts";
import { clientIp } from "../ip.ts";
import { type MarketState, blockersFor, marketStateFrom } from "../blockers.ts";
import { type KeyedDaily, type Limiter, keyedDaily, limits, tokenBucket } from "../ratelimit.ts";
import { apiError, json, rateLimited, readJsonCapped } from "./http.ts";
import { availableBalance, callerFor, escrowAccount, isFunctionCallKey, nearErrorMessage, nearToYocto, relayerAccount, type WaitUntil } from "./near.ts";
import { RelayRuns, type Snap } from "./relayRuns.ts";
import { type RelayValidateConfig, validateArrowMultipayload } from "./relayValidate.ts";
import { NETWORKS } from "@arrow/sdk/config";

// One execute_intents prepays 600 TGas = 0.60 NEAR, locked until every follow-up receipt has run (about 40-60 s, measured on
// mainnet). Below this a second payment passes the balance check and then fails inside the node.
const MIN_RELAYER_BALANCE = nearToYocto("0.65");
/** Evals are the one op a funded signer can repeat for free (a failed eval refunds); keep this much tank for lists and buys. */
const EVAL_TANK_RESERVE = 10n;
const NOT_ENOUGH_BALANCE = /NotEnoughBalance|does not have enough balance/i;

export interface RelayerPort {
  accountId: string;
  balance(): Promise<bigint>;
  /** True when the configured key can only call execute_intents on intents.near. A full-access key in the env is refused. */
  keyIsFunctionCall(): Promise<boolean>;
  caller(waitUntil: WaitUntil): NearCaller;
}

/** The two reads of the market contract that decide whether a payment can succeed. */
export interface ChainPort {
  listing(id: number): Promise<Listing | null>;
  /** get_config().config.listing_bond, USDC base units. */
  listingBond(): Promise<bigint>;
  /** paused, program key, tank and program hash (E05, E06, E10, E13). */
  market(): Promise<MarketState>;
}

export interface RelayDeps {
  limiter: Limiter;
  /** Per signed-in EVM address, taken only for a payload this instance has not seen (a replay costs the relayer nothing). */
  signerLimiter: Limiter;
  /** All signers together, eval only: a free (refunded) eval is the cheapest way to drain the gas tank. */
  evalLimiter: Limiter;
  /** Evals per signer per UTC day. */
  evalDaily: KeyedDaily;
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

const MAX_BODY_BYTES = 64 * 1024;

const SELF_RELAY =
  "send execute_intents yourself: near contract call-function as-transaction intents.near execute_intents json-args '{\"signed\":[<your multipayload>]}' prepaid-gas '600 TGas' attached-deposit '0 NEAR' sign-as <your account> network-config mainnet sign-with-keychain send";

let pathCache: { at: number; v: "notify" | "escrow" } | undefined;

const mainnetViews = () => new ArrowViews("mainnet", CONTRACTS.mainnet);

let marketCache: { at: number; v: MarketState } | undefined;

export const realRelayDeps: RelayDeps = {
  limiter: limits.relay,
  signerLimiter: tokenBucket({ capacity: 5, refillEveryMs: 30_000 }), // a session needs about 3 payments
  evalLimiter: tokenBucket({ capacity: 20, refillEveryMs: 3 * 60_000 }), // 20 evals an hour per instance
  evalDaily: keyedDaily({ max: 10 }),
  store: new RelayRuns(),
  waitMs: 50_000,
  chain: {
    listing: (id) => mainnetViews().listing(id),
    async listingBond() {
      const bond = (await mainnetViews().config()).config.listing_bond;
      if (typeof bond !== "string" || !/^\d+$/.test(bond)) throw new Error("get_config has no listing_bond");
      return BigInt(bond);
    },
    async market() {
      if (marketCache && Date.now() - marketCache.at < 10_000) return marketCache.v;
      const views = mainnetViews();
      const [cv, pk] = await Promise.all([views.config(), views.programPubkey()]);
      marketCache = { at: Date.now(), v: marketStateFrom(cv, pk) };
      return marketCache.v;
    },
  },
  cfg: { contract: CONTRACTS.mainnet, usdcToken: NETWORKS.mainnet.usdcToken },
  relayer() {
    const a = relayerAccount();
    return a && { accountId: a.accountId, balance: () => availableBalance(a), keyIsFunctionCall: () => isFunctionCallKey(a), caller: (w) => callerFor(a, w) };
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
      error: "Your payment may or may not have gone through: the relayer could not confirm it. Do not pay again yet: use Check payment on the page, or look at your NEAR Intents balance.",
      code: "RELAY_UNCLEAR",
      unclear: true,
      ...(detail ? { detail } : {}),
    }),
  );

const NONCE_USED = /nonce.*(used|already)|already.*used/i;

/** amount and listing against the contract's own rules (E07, E08, E09), so a payment that would panic costs no gas. */
async function checkAgainstChain(v: Extract<ReturnType<typeof validateArrowMultipayload>, { ok: true }>, chain: ChainPort): Promise<Response | null> {
  const low = (what: string, need: bigint) => apiError(400, "AMOUNT_TOO_LOW", `The payment is ${v.amount} base units but ${what} is ${need}.`);
  const blocked = (b: ReturnType<typeof blockersFor>[number]) => apiError(409, b.code, `${b.message} Nothing was sent.`);
  try {
    const market = await chain.market();
    if (v.op === "list") {
      const bond = await chain.listingBond();
      if (v.amount < bond) return low("the listing bond", bond);
      const [b] = blockersFor("list", market);
      return b ? blocked(b) : null;
    }
    const l = await chain.listing(v.listingId!);
    if (!l) return apiError(404, "LISTING_NOT_FOUND", `Listing ${v.listingId} does not exist.`);
    if (v.op === "rehost") {
      // E23 / E05 / E06: the whole amount comes back, so only the seller's own listing on an open market is relayed.
      if (l.seller !== v.signerId) return apiError(403, "NOT_SELLER", "Only the listing's seller can move its file. Nothing was sent.");
      if (v.amount < 1n) return low("the minimum transfer", 1n);
      const [b] = blockersFor("rehost", market);
      return b ? blocked(b) : null;
    }
    if (v.op === "eval") {
      if (v.amount < BigInt(l.eval_fee)) return low("the eval fee", BigInt(l.eval_fee));
      if (l.evals_used >= l.max_evals) return apiError(409, "BUDGET_EXHAUSTED", "This listing's inspection budget is used up: it is buy-only.");
    } else if (v.amount < BigInt(l.price)) return low("the price", BigInt(l.price));
    const [b] = blockersFor(v.op, market, l);
    if (b) return blocked(b);
    if (v.op === "eval" && market.tankAvailable < market.tankMin + market.depositEval * EVAL_TANK_RESERVE) {
      return apiError(409, "TANK_LOW", "The market keeps its last gas for purchases, so new inspections are paused until the tank is topped up. Nothing was sent.");
    }
    return null;
  } catch (e) {
    return apiError(502, "RPC_ERROR", "Could not read the market contract. Nothing was sent; try again.", { detail: nearErrorMessage(e).slice(0, 300) });
  }
}

export async function handleRelay(req: Request, d: RelayDeps = realRelayDeps): Promise<Response> {
  const rl = d.limiter.take(clientIp(req));
  if (!rl.ok) return rateLimited(rl.retryAfterSec);

  const raw = await readJsonCapped(req, MAX_BODY_BYTES);
  if (raw.tooLarge) return apiError(413, "TOO_LARGE", "The request body is too large.");
  const body = RelayRequest.safeParse(raw.value);
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
    if (!(await relayer.keyIsFunctionCall())) return before(unavailable("The relayer key is not restricted to execute_intents, so this deployment refuses to use it."));
    if ((await relayer.balance()) < MIN_RELAYER_BALANCE) {
      return before(apiError(503, "RELAYER_BUSY", "The relayer is carrying another payment right now. Nothing was sent; try again in a minute.", { fallback: SELF_RELAY, retryAfterSec: 60 }));
    }
  } catch (e) {
    return before(apiError(502, "RPC_ERROR", "Could not read the relayer balance.", { detail: nearErrorMessage(e).slice(0, 300) }));
  }

  try {
    await d.simulate(mp);
  } catch (e) {
    const msg = String((e as Error).message ?? e).slice(0, 300);
    if (e instanceof RpcError && e.retryable) return before(apiError(502, "RPC_ERROR", "NEAR RPC is unavailable. Try again.", { detail: msg }));
    if (NONCE_USED.test(msg)) {
      return before(apiError(409, "ALREADY_RELAYED", "This exact signed payment was already submitted to NEAR Intents. Do not pay again: use Check payment on the page, or look at your NEAR Intents balance.", { detail: msg }));
    }
    return before(apiError(422, "SIMULATE_FAILED", "intents.near rejected the signed intent in simulation.", { detail: msg }));
  }

  if (v.op === "eval") {
    const g = d.evalLimiter.take("all");
    if (!g.ok) return before(rateLimited(g.retryAfterSec, "EVAL_RATE_LIMITED"));
    if (!d.evalDaily.take(v.signerId)) return before(apiError(429, "EVAL_DAILY_CAP", "This wallet used its inspections for today through the hosted relay. Try again tomorrow, or relay it yourself.", { fallback: SELF_RELAY, retryAfterSec: 3600 }));
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
    // The account was too poor to prepay the gas: the node refused it, nothing is on chain.
    if (NOT_ENOUGH_BALANCE.test(nearErrorMessage(e))) {
      return before(apiError(503, "RELAYER_BUSY", "The relayer is carrying another payment right now. Nothing was sent; try again in a minute.", { fallback: SELF_RELAY, retryAfterSec: 60 }));
    }
    // From here the transaction may be on chain (a timeout says nothing), so this is not reported as a failed payment.
    return { res: respond(await unclear(nearErrorMessage(e).slice(0, 300))), broadcast: true };
  }
}
