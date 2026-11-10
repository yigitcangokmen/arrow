// EIP-1193 wallet access for the browser (DEC L-03: viem only, no wagmi). Client code: import from "use client" components.
import { createWalletClient, custom, type EIP1193Provider, type Hex, recoverMessageAddress, type SignableMessage, type WalletClient } from "viem";
import { base } from "viem/chains";
import type { IntentSigner } from "@arrow/sdk/intent";

/** Native USDC on Base: the origin asset of the 1Click top-up (DEC K-01). */
export const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

export class NoWalletError extends Error {
  constructor() {
    super("Install MetaMask or another EIP-1193 wallet");
    this.name = "NoWalletError";
  }
}

export interface Eoa {
  address: `0x${string}`;
  /** The NEAR Intents account of this wallet: its 0x address, lowercase. */
  intentsId: string;
  client: WalletClient;
  signMessage(a: { message: SignableMessage }): Promise<Hex>;
}

const provider = (): EIP1193Provider | undefined => (typeof window === "undefined" ? undefined : (window as { ethereum?: EIP1193Provider }).ethereum);

export const hasWallet = (): boolean => provider() !== undefined;

const errorCode = (e: unknown): number | undefined => {
  const o = e as { code?: number; cause?: { code?: number } } | null;
  return o?.code ?? o?.cause?.code;
};

export class NotEoaError extends Error {
  constructor() {
    super("This wallet account is a smart-contract wallet. NEAR Intents can only verify a plain account (EOA) signature, so money sent to it from Base could never be spent. Connect an EOA.");
    this.name = "NotEoaError";
  }
}

/** What the wallet signs once to prove the account is an EOA. It moves nothing. */
export const EOA_CHALLENGE = "Arrow: this message proves that your wallet is a regular account (an EOA) that can sign NEAR Intents transfers. It moves no money.";

const verifiedKey = (address: string) => `arrow:eoa-ok:${address.toLowerCase()}`;
const knownEoa = (storage: Pick<Storage, "getItem"> | undefined, address: string): boolean => {
  try {
    return storage?.getItem(verifiedKey(address)) === "1";
  } catch {
    return false;
  }
};

/**
 * A smart-contract wallet's signature (ERC-1271 or 6492) never recovers to its own address, and intents.near has no ERC-1271
 * path, so USDC credited to such an address could never sign again. One signature over a fixed text settles it; a verified
 * address is remembered in this browser.
 */
export async function assertEoa(a: {
  address: string;
  sign(message: string): Promise<Hex>;
  recover?: (message: string, signature: Hex) => Promise<string>;
  storage?: Pick<Storage, "getItem" | "setItem">;
}): Promise<void> {
  if (knownEoa(a.storage, a.address)) return;
  const recover = a.recover ?? ((message, signature) => recoverMessageAddress({ message, signature }));
  let ok = false;
  try {
    ok = (await recover(EOA_CHALLENGE, await a.sign(EOA_CHALLENGE))).toLowerCase() === a.address.toLowerCase();
  } catch (e) {
    if (errorCode(e) === 4001 || /reject|denied/i.test(String((e as Error)?.message))) throw e; // the user said no: not the same as "not an EOA"
    ok = false;
  }
  if (!ok) throw new NotEoaError();
  try {
    a.storage?.setItem(verifiedKey(a.address), "1");
  } catch {
    // the proof is asked again next time
  }
}

export async function connectEoa(): Promise<Eoa> {
  const eth = provider();
  if (!eth) throw new NoWalletError();
  const client = createWalletClient({ chain: base, transport: custom(eth) });
  const [address] = await client.requestAddresses();
  if (!address) throw new Error("The wallet returned no account");
  let storage: Storage | undefined;
  try {
    storage = window.localStorage;
  } catch {
    storage = undefined;
  }
  await assertEoa({ address, sign: (message) => client.signMessage({ account: address, message }), storage });
  return {
    address,
    intentsId: address.toLowerCase(),
    client,
    signMessage: ({ message }) => client.signMessage({ account: address, message }),
  };
}

/** Calls `onChange` with the new first account (lowercase) or null when the wallet disconnects. Returns the unsubscribe. */
export function watchAccounts(onChange: (next: string | null) => void, eth: Pick<EIP1193Provider, "on" | "removeListener"> | undefined = provider()): () => void {
  if (!eth?.on) return () => undefined;
  const handler = (accounts: unknown) => onChange(Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0].toLowerCase() : null);
  eth.on("accountsChanged", handler as never);
  return () => eth.removeListener?.("accountsChanged", handler as never);
}

/** The `{address, signMessage}` shape the intents sdk signs with. */
export const intentSigner = (eoa: Eoa): IntentSigner => ({ address: eoa.address, signMessage: eoa.signMessage }) as IntentSigner;

/** Switches the wallet to Base (chain 8453), adding the network first when the wallet does not know it (code 4902). */
export async function ensureBase(eoa: Eoa): Promise<void> {
  if ((await eoa.client.getChainId()) === base.id) return;
  try {
    await eoa.client.switchChain({ id: base.id });
  } catch (e) {
    if (errorCode(e) !== 4902) throw e;
    await eoa.client.addChain({ chain: base });
    await eoa.client.switchChain({ id: base.id });
  }
}
