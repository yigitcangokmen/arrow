// S4-a: does 1Click deliver Base USDC to the buyer's 0x... Intents account, and how fast? (DEC K-01, G-06)
//   --dry   : balances + a dry quote only. Free, nothing is signed or sent. The agent may run this.
//   (no flag): real quote -> spend plan -> Base USDC transfer to the 1Click deposit address -> poll /v0/status.
//              This moves value on mainnet: it is the human step H-08a (a TTY answers y; --yes only for a human).
// --gates-line prints a GATES.md draft after a real run. Written by WS4-T05; WS1 owns the gate row.
import { parseArgs } from "node:util";
import { privateKeyToAccount } from "viem/accounts";
import { oneclick, formatUsdc, parseUsdc } from "@arrow/sdk";
import { appendRun, gitCommit } from "../../scripts/src/lib/evidence.ts";
import { loadEnv, requireEnv } from "../../scripts/src/lib/env.ts";
import { ethBalance, sendUsdc, usdcBalance, waitReceipt } from "../../scripts/src/lib/base.ts";
import { confirmSpend } from "../../scripts/src/lib/confirm.ts";
import { mtBalanceOf } from "../../scripts/src/lib/intents.ts";
import { explorerTx, log } from "../../scripts/src/lib/log.ts";

loadEnv();
const { values } = parseArgs({
  options: {
    amount: { type: "string", default: "2" },
    dry: { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
    slippage: { type: "string" },
    "gates-line": { type: "boolean", default: false },
  },
});

const amountUnits = parseUsdc(values.amount!);
const slippageBps = values.slippage ? Number(values.slippage) : undefined;
const privateKey = requireEnv("E2E_BUYER_EVM_PRIVATE_KEY") as `0x${string}`;
const buyer = privateKeyToAccount(privateKey).address;
const buyer0x = buyer.toLowerCase() as `0x${string}`;
const fmt = (u: bigint) => formatUsdc(u);

log(`buyer (Base + Intents account): ${buyer0x}`);
const [baseUsdc, baseEth] = await Promise.all([usdcBalance(buyer), ethBalance(buyer)]);
log(`Base USDC ${fmt(baseUsdc)} · ETH ${Number(baseEth) / 1e18}`);

const dry = await oneclick.quote(oneclick.inboundQuoteRequest({ amount: amountUnits.toString(), evm: buyer0x, dry: true, slippageBps }));
log(`dry quote 200 · amountIn ${dry.quote.amountInFormatted} · amountOut ${dry.quote.amountOutFormatted} (${dry.quote.amountOut}) · timeEstimate ${dry.quote.timeEstimate} s`);
if (values.dry) {
  log("dry run: nothing signed, nothing sent");
  process.exit(0);
}

if (baseUsdc < amountUnits) throw new Error(`buyer has ${fmt(baseUsdc)} Base USDC, need ${fmt(amountUnits)} (H-03)`);
const real = await oneclick.quote(oneclick.inboundQuoteRequest({ amount: amountUnits.toString(), evm: buyer0x, dry: false, slippageBps }));
const depositAddress = real.quote.depositAddress;
if (!depositAddress) throw new Error("real quote returned no depositAddress");
log(`deposit address: ${depositAddress} · quote expires ${real.quote.deadline ?? "?"}`);

await confirmSpend(
  [`send ${fmt(amountUnits)} USDC on Base: ${buyer0x} -> 1Click deposit ${depositAddress}`, `expect ~${dry.quote.amountOutFormatted} USDC on the Intents account ${buyer0x} in ~${dry.quote.timeEstimate} s`, "network: mainnet (Base + NEAR Intents)"],
  values.yes!,
);

const before = await mtBalanceOf("mainnet", buyer0x);
const sentAt = Date.now();
const txHash = await sendUsdc(privateKey, depositAddress as `0x${string}`, amountUnits);
// A Base tx hash is 0x + 64 hex, the same shape log() masks as a private key, so the link goes through console.log.
console.log(`base tx ${explorerTx("mainnet", "base", txHash)}`);
const receipt = await waitReceipt(txHash);
if (receipt.status !== "success") throw new Error(`Base transfer reverted: ${txHash}`);
await oneclick.submitDeposit({ txHash, depositAddress });

const final = await oneclick.waitForStatus(depositAddress, {
  onTick: (s, ms) => log(`status ${s.status} · ${Math.round(ms / 1000)} s`),
});
const seconds = Math.round((Date.now() - sentAt) / 1000);
const after = await mtBalanceOf("mainnet", buyer0x);
const delta = after - before;
const pass = final.status === "SUCCESS" && delta > 0n;

const observed = `status ${final.status} in ${seconds} s; intents USDC ${fmt(before)} -> ${fmt(after)} (+${fmt(delta)})`;
appendRun("mainnet", {
  id: `s4a-inbound-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  kind: "inbound",
  tx: txHash,
  chain: "base",
  block_height: Number(receipt.blockNumber),
  listing_id: null,
  eval_id: null,
  purchase_id: null,
  oneclick_deposit: depositAddress,
  expect: "SUCCESS < 120 s, +~1.99 USDC on the Intents account",
  observed,
  script: "spikes/s4/s4a-inbound.ts",
});

console.log(`S4-a ${pass ? "PASS" : "FAIL"} · status ${final.status} in ${seconds} s · intents USDC +${fmt(delta)} · base tx ${explorerTx("mainnet", "base", txHash)}`);
if (seconds > 120 && pass) log("note: SUCCESS took more than 120 s; the gate still passes but the time is recorded (video uses a sped-up counter, DEC T-09)");
if (values["gates-line"]) {
  log(`### S4-a · ${pass ? "PASS" : "FAIL"} · ${new Date().toISOString()}`);
  log(`- Commands: npx tsx spikes/s4/s4a-inbound.ts --amount ${values.amount}`);
  log(`- Evidence: evidence/mainnet.json inbound run · ${observed} · commit ${gitCommit().slice(0, 7)}`);
}
process.exit(pass ? 0 : 1);
