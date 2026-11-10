// Base (EVM) helpers for the 1Click inbound leg (WS4-T05). viem only; the RPC is BASE_RPC_URL.
import { createPublicClient, createWalletClient, erc20Abi, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

const transport = () => http(process.env.BASE_RPC_URL || "https://mainnet.base.org");
const publicClient = () => createPublicClient({ chain: base, transport: transport() });

export const usdcBalance = (address: `0x${string}`): Promise<bigint> =>
  publicClient().readContract({ address: BASE_USDC, abi: erc20Abi, functionName: "balanceOf", args: [address] });

export const ethBalance = (address: `0x${string}`): Promise<bigint> => publicClient().getBalance({ address });

/** ERC-20 transfer of Base USDC. An ERC-20 transfer needs ETH for gas, so a zero ETH balance fails first with a clear message. */
export async function sendUsdc(privateKey: Hex, to: `0x${string}`, amount: bigint): Promise<Hex> {
  const account = privateKeyToAccount(privateKey);
  if ((await ethBalance(account.address)) === 0n) throw new Error(`${account.address} has 0 ETH on Base: an ERC-20 transfer needs gas`);
  const wallet = createWalletClient({ account, chain: base, transport: transport() });
  return wallet.writeContract({ address: BASE_USDC, abi: erc20Abi, functionName: "transfer", args: [to, amount] });
}

export const waitReceipt = (hash: Hex) => publicClient().waitForTransactionReceipt({ hash });
