// EIP-1193 wallet access for the browser (DEC L-03: viem only, no wagmi). Client code: import from "use client" components.
import { createWalletClient, custom, type EIP1193Provider, type Hex, type SignableMessage, type WalletClient } from "viem";
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

export async function connectEoa(): Promise<Eoa> {
  const eth = provider();
  if (!eth) throw new NoWalletError();
  const client = createWalletClient({ chain: base, transport: custom(eth) });
  const [address] = await client.requestAddresses();
  if (!address) throw new Error("The wallet returned no account");
  return {
    address,
    intentsId: address.toLowerCase(),
    client,
    signMessage: ({ message }) => client.signMessage({ account: address, message }),
  };
}

/** The `{address, signMessage}` shape the intents sdk signs with. */
export const intentSigner = (eoa: Eoa): IntentSigner => ({ address: eoa.address, signMessage: eoa.signMessage }) as IntentSigner;

const errorCode = (e: unknown): number | undefined => {
  const o = e as { code?: number; cause?: { code?: number } } | null;
  return o?.code ?? o?.cause?.code;
};

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
