// Testnet judge accounts (DEC L-09, P-01). The server only ever sees the PUBLIC key; the private key is made in the client.
import { SponsorRequest } from "@arrow/sdk/schemas";
import { clientIp } from "../ip.ts";
import { type Limiter, limits } from "../ratelimit.ts";
import { apiError, json, rateLimited, readJsonCapped } from "./http.ts";
import { sameSiteJson } from "./origin.ts";
import { availableBalance, nearErrorMessage, nearToYocto, sponsorAccount } from "./near.ts";

const MIN_SPONSOR_BALANCE = nearToYocto("2");
const FAUCET_FALLBACK = "use the NEAR testnet faucet: near account create-account sponsor-by-faucet-service <name>.testnet autogenerate-new-keypair save-to-keychain network-config testnet create";
const OFFLINE_FALLBACK = "npm run verify && npm run bench:offline";

export interface SponsorPort {
  accountId: string;
  balance(): Promise<bigint>;
  createSubAccount(prefix: string, publicKey: string, yocto: bigint): Promise<{ txHash: string }>;
}

export interface SponsorDeps {
  limiter: Limiter;
  daily: { take(): boolean };
  sponsor(): SponsorPort | null;
  nearPerAccount: string;
  now?: () => number;
  random?: () => string; // 4 base-36 characters
}

/** "j" + time in base 36 + 4 random base-36 characters: only [a-z0-9], well inside the 64 character limit. */
export function subAccountPrefix(now: number, rand: string): string {
  return "j" + now.toString(36) + rand;
}

function randomBase36(n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

export const realSponsorDeps: SponsorDeps = {
  limiter: limits.sponsor,
  daily: limits.sponsorDaily,
  nearPerAccount: process.env.TESTNET_SPONSOR_NEAR_PER_ACCOUNT ?? "0.5",
  sponsor() {
    const a = sponsorAccount();
    return (
      a && {
        accountId: a.accountId,
        balance: () => availableBalance(a),
        async createSubAccount(prefix, publicKey, yocto) {
          const r = await a.createSubAccount({ accountOrPrefix: prefix, publicKey, nearToTransfer: yocto });
          return { txHash: r.transaction.hash as string };
        },
      }
    );
  },
};

export async function handleSponsor(req: Request, d: SponsorDeps = realSponsorDeps): Promise<Response> {
  const rl = d.limiter.take(clientIp(req));
  if (!rl.ok) return rateLimited(rl.retryAfterSec);

  const foreign = sameSiteJson(req);
  if (foreign) return foreign;
  const read = await readJsonCapped(req, 4 * 1024);
  if (read.tooLarge) return apiError(413, "TOO_LARGE", "The request body is too large.");
  const body = SponsorRequest.safeParse(read.value);
  if (!body.success) return apiError(400, "BAD_KEY", "publicKey must be \"ed25519:<base58 public key>\"");

  const sponsor = d.sponsor();
  const unavailable = () => apiError(503, "SPONSOR_UNAVAILABLE", "The testnet sponsor is out of funds or not configured.", { fallback: FAUCET_FALLBACK });
  if (!sponsor) return unavailable();
  try {
    if ((await sponsor.balance()) < MIN_SPONSOR_BALANCE) return unavailable();
  } catch {
    return unavailable();
  }

  if (!d.daily.take()) return apiError(429, "DAILY_CAP", "The daily limit of sponsored testnet accounts is used up.", { fallback: OFFLINE_FALLBACK });

  const prefix = subAccountPrefix((d.now ?? Date.now)(), (d.random ?? (() => randomBase36(4)))());
  try {
    const { txHash } = await sponsor.createSubAccount(prefix, body.data.publicKey, nearToYocto(d.nearPerAccount as `${number}`));
    return json(200, { accountId: `${prefix}.${sponsor.accountId}`, txHash, nearAmount: d.nearPerAccount });
  } catch (e) {
    return apiError(503, "SPONSOR_UNAVAILABLE", "Creating the testnet account failed.", { fallback: FAUCET_FALLBACK, detail: nearErrorMessage(e).slice(0, 300) });
  }
}
