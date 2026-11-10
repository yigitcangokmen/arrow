// setup-relayer: prints the near-cli command that adds the relayer's FunctionCall key, and with --check verifies the key on chain.
// Running the printed command on mainnet is the human step H-07 (it signs with the account's keychain key). This script never signs.
//   setup-relayer.ts [--network mainnet|testnet] [--account <id>] [--receiver <id>] [--check] [--escrow] [--key-file <path>] [--pubkey <ed25519:..>]
// Public key source: --pubkey, else --key-file (near credential JSON), else mainnet .env RELAYER_PRIVATE_KEY,
// else the testnet twin key ~/.near-credentials/testnet/relayer-fc.json (never written to .env).
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { KeyPair } from "near-api-js";
import { ArrowViews, type Network, NETWORKS, viewAccessKey, viewAccount } from "@arrow/sdk";
import { loadEnv } from "./lib/env.ts";
import { log } from "./lib/log.ts";
import { addKeyCommand, balanceWarnings, ESCROW_METHODS, INTENTS_METHODS, keyProblems, okLine, type KeySpec } from "./lib/relayer.ts";

loadEnv();
const { values } = parseArgs({
  options: {
    network: { type: "string", default: "mainnet" },
    account: { type: "string" },
    receiver: { type: "string" },
    check: { type: "boolean", default: false },
    escrow: { type: "boolean", default: false },
    "key-file": { type: "string" },
    pubkey: { type: "string" },
  },
});
if (values.network !== "mainnet" && values.network !== "testnet") {
  console.error("--network must be mainnet or testnet");
  process.exit(2);
}
const network: Network = values.network;
const account = values.account ?? (network === "mainnet" ? process.env.RELAYER_ACCOUNT_ID || "arrow-relayer.arrowhq.near" : process.env.RELAYER_TESTNET_ACCOUNT_ID || "relayer.arrowhq.testnet");
const spec: KeySpec = { receiver: values.receiver ?? (network === "mainnet" ? "intents.near" : NETWORKS.testnet.contract), methods: INTENTS_METHODS };

const fail = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

function publicKeyFromCredential(file: string): string {
  const j = JSON.parse(readFileSync(file, "utf8"));
  if (typeof j.public_key === "string") return j.public_key;
  if (typeof j.private_key === "string") return KeyPair.fromString(j.private_key).getPublicKey().toString();
  return fail(`${file} has neither public_key nor private_key`);
}

function publicKeyOf(): string {
  if (values.pubkey) return values.pubkey;
  if (values["key-file"]) return publicKeyFromCredential(resolve(values["key-file"]));
  if (network === "mainnet") {
    const sk = process.env.RELAYER_PRIVATE_KEY;
    if (!sk) return fail("RELAYER_PRIVATE_KEY is empty: run `npx tsx scripts/src/new-near-keypair.ts --env RELAYER_PRIVATE_KEY` first");
    return KeyPair.fromString(sk as `ed25519:${string}`).getPublicKey().toString();
  }
  const twin = resolve(homedir(), ".near-credentials/testnet/relayer-fc.json");
  if (!existsSync(twin)) return fail(`no testnet twin key: run new-near-keypair.ts --out ${twin} --account ${account}`);
  return publicKeyFromCredential(twin);
}

function escrowPublicKey(): string | undefined {
  const sk = process.env.RELAYER_ESCROW_PRIVATE_KEY;
  return sk ? KeyPair.fromString(sk as `ed25519:${string}`).getPublicKey().toString() : undefined;
}

async function isEscrow(): Promise<boolean> {
  if (values.escrow) return true;
  try {
    return (await new ArrowViews(network).version()).payment_path === "escrow";
  } catch {
    return false; // the contract is not deployed yet: the Notify path is the default
  }
}

// log() masks every ed25519: key of 40+ characters, public ones included. The commands below carry public keys only, so they go
// through console.log, after checking that what is printed has the length of a public key (a private key is twice as long).
const PUBLIC_KEY = /^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const printCommand = (publicKey: string, s: KeySpec) => {
  if (!PUBLIC_KEY.test(publicKey)) fail("refusing to print: the key is not a 43-44 character ed25519 public key");
  console.log(addKeyCommand({ network, account, publicKey, spec: s }));
};

const escrow = await isEscrow();
const escrowSpec: KeySpec = { receiver: NETWORKS[network].contract, methods: ESCROW_METHODS };
const pk = publicKeyOf();

if (!values.check) {
  log(`add the relayer key (${network}); this signs with ${account}'s keychain key, so it is the human step H-07 on mainnet:`);
  printCommand(pk, spec);
  if (escrow) {
    const pk2 = escrowPublicKey();
    log(pk2 ? "escrow path (H-07b): second key" : "escrow path (H-07b): RELAYER_ESCROW_PRIVATE_KEY is empty, generate it with new-near-keypair.ts --env RELAYER_ESCROW_PRIVATE_KEY first");
    if (pk2) printCommand(pk2, escrowSpec);
  }
  log(`then verify: npx tsx scripts/src/setup-relayer.ts --network ${network} --account ${account} --check`);
  process.exit(0);
}

let failed = false;
const verify = async (label: string, publicKey: string, s: KeySpec) => {
  let permission;
  try {
    permission = (await viewAccessKey(network, account, publicKey)).permission;
  } catch (e) {
    log(`${label}: ${(e as Error).message}`);
  }
  const problems = keyProblems(permission, s);
  if (problems.length === 0) log(`${label}: ${okLine(s)}`);
  else {
    failed = true;
    for (const p of problems) log(`${label}: FAIL ${p}`);
  }
};

await verify("relayer key", pk, spec);
if (escrow) {
  const pk2 = escrowPublicKey();
  if (!pk2) {
    failed = true;
    log("escrow key: FAIL RELAYER_ESCROW_PRIVATE_KEY is empty (escrow path needs the second key, H-07b)");
  } else await verify("escrow key", pk2, escrowSpec);
}

try {
  const { amount } = await viewAccount(network, account);
  for (const w of balanceWarnings(amount)) log(`WARN ${w}`);
} catch (e) {
  failed = true;
  log(`FAIL account ${account}: ${(e as Error).message}`);
}
process.exit(failed ? 1 : 0);
