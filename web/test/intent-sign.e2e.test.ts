// Network test (ARROW_E2E=1), free: the exact msgs /sell and /buy send, signed ERC-191 by a throwaway unfunded EOA and
// run through intents.near simulate_intents (a view). Pass = only a balance error, never a signature, nonce or msg error.
import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { NETWORKS } from "@arrow/sdk/config";
import { publicKeyHex, scalarFromLabel } from "@arrow/sdk/crypto";
import { prepareBuy, prepareEval } from "@arrow/sdk/flows";
import { arrowTransferIntent, buildAndSignTransfer } from "@arrow/sdk/intent";
import { simulateIntents } from "@arrow/sdk/rpc";
import { buildListMsg, type SellFields } from "../lib/sell.ts";
import { encryptFile } from "@arrow/sdk/crypto";

const programPk = publicKeyHex(scalarFromLabel("arrow:test:program:v1"));
const buyerPk = publicKeyHex(scalarFromLabel("arrow:test:buyer:v1"));
const fields: SellFields = {
  prefix: "[synthetic]", title: "Probe", publicDesc: "e2e probe", columns: ["a", "b"], rowsClaimed: 1, price: "0.25", evalFee: "0.10", maxEvals: 5, mode: "scored",
};
const plain = new TextEncoder().encode("a,b\n1,2\n");

function listMsg(): string {
  const enc = encryptFile(plain);
  return buildListMsg({ fields, plaintext: plain, key: enc.key, nonce: enc.blob.slice(0, 24), blobUrl: "https://example.com/blobs/probe.bin", programPk }).msg;
}

describe.skipIf(!process.env.ARROW_E2E)("web msgs through simulate_intents (mainnet, unfunded signer)", () => {
  const cases: [string, () => string, string][] = [
    ["list", listMsg, "100000"],
    ["eval", () => prepareEval({ listingId: 1, criteria: { v: 1, text: "probe" }, buyerPk, programPk }), "100000"],
    ["buy", () => prepareBuy({ listingId: 1, buyerPk }), "250000"],
  ];
  for (const [name, msg, amount] of cases) {
    it(`${name}_msg_signature_ok_balance_error_only`, async () => {
      const fresh = privateKeyToAccount(generatePrivateKey());
      const intent = arrowTransferIntent({ receiverId: NETWORKS.mainnet.contract, tokenId: NETWORKS.mainnet.usdcToken, amount, msg: msg() });
      const { multipayload } = await buildAndSignTransfer({ signer: fresh, intents: [intent] });
      const err = await simulateIntents([multipayload]).then(() => "", (e: Error) => e.message);
      expect(err).toMatch(/insufficient balance or overflow|account '0x[0-9a-f]{40}' not found/);
      expect(err).not.toMatch(/invalid signature|public key|invalid nonce|invalid salt|deadline|wrong verifying_contract|JSON:/);
    }, 60_000);
  }
});
