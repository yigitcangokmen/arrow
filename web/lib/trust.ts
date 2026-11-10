// Trust table rows for the UI. The README table is the source of truth: part names and flags (RISKY, NOT PROVEN, TODO) must
// match it, and web/test/trust.test.ts diffs them. One row differs in wording on purpose: the 1Click row avoids a phrase that
// DEC R-03 forbids.
export interface TrustRow {
  part: string;
  trust: string;
  sees: string;
  cannot: string;
  check: string;
  flag?: "RISKY" | "NOT PROVEN" | "TODO";
}

export const TRUST_ROWS: readonly TrustRow[] = [
  {
    part: "Seller data at rest",
    trust: "Nobody (ciphertext; the host is untrusted)",
    sees: "—",
    cannot: "Decrypt",
    check: "blob_sha256 is on chain and the enclave checks it before reading. Not yet shown on mainnet",
    flag: "TODO",
  },
  {
    part: "Program key / PROTECTED_MASTER",
    trust: "OutLayer keystore (TDX) and the shared OutLayer master",
    sees: "Inside the TEE",
    cannot: "Release to an unpinned wasm or a non-Arrow caller",
    check: "WasmHash and Predecessor conditions; in-wasm network allowlist; negative tests recorded on /verify",
  },
  {
    part: "OutLayer keystore DAO",
    trust: "Can export keys on \"cessation\"",
    sees: "Potentially everything",
    cannot: "—",
    check: "Open risk",
    flag: "RISKY",
  },
  {
    part: "Evaluation",
    trust: "Intel TDX (OutLayer worker)",
    sees: "Plaintext inside the TEE",
    cannot: "Emit anything outside the schema",
    check: "Open source; attestation wasm_hash",
  },
  {
    part: "LLM",
    trust: "NEAR AI gateway (TDX) and the model TEE (TDX + NVIDIA CC)",
    sees: "A 40-row sample and the criteria",
    cannot: "Retain data (NEAR AI's zero-data-retention claim is a trust assumption)",
    check: "/v1/attestation/report shows the endpoint's current attestation, not eval-time; the wasm does not verify quotes itself",
    flag: "NOT PROVEN",
  },
  {
    part: "Wasm to NEAR AI",
    trust: "TLS (not E2EE)",
    sees: "—",
    cannot: "—",
    check: "Endpoint and model ID are fixed in the source",
    flag: "RISKY",
  },
  {
    part: "OutLayer coordinator (closed source)",
    trust: "Liveness",
    sees: "Encrypted input",
    cannot: "Read secrets",
    check: "If it fails, the callback gets null and the buyer is refunded: a purchase in full, an eval less the treasury's share of the fee",
  },
  {
    part: "outlayer.near, intents.near contracts",
    trust: "Their owners (both are upgradable); Arrow depends on them",
    sees: "—",
    cannot: "—",
    check: "Open risk; verify reads historical transactions",
    flag: "RISKY",
  },
  {
    part: "Arrow operator",
    trust: "Relayer liveness and the gas tank",
    sees: "Encrypted blobs",
    cannot: "The plan after the lock, not yet a fact: read data, take funds, or change the contract or wasm hash",
    check: "Not locked yet: there is no lock transaction, and the mainnet market contract is not deployed. The contract is meant to own itself with no access keys; npm run verify (row R6) shows it once it is done",
    flag: "TODO",
  },
  {
    part: "NEAR AI API key (inside the OutLayer secret)",
    trust: "Billing",
    sees: "Usage volume",
    cannot: "See content",
    check:
      "The mainnet inference key is the NEAR Builders hackathon key. It cannot be topped up and its expiry is not published; if it runs out, evals refund by design.",
    flag: "RISKY",
  },
  {
    part: "1Click and the PoA bridge (Intents Technology)",
    trust: "Short custody during swaps. Users do not see a bridge step, but Base and Solana USDC arrive as omft.near bridged tokens",
    sees: "Swap transactions",
    cannot: "—",
    check: "1Click /v0/status. Paid inbound ran once on mainnet (2 USDC from Base); the outbound Solana withdrawal is a dry quote only. Custody is not shown",
    flag: "NOT PROVEN",
  },
  {
    part: "Output channel",
    trust: "Schema and rule composition",
    sees: "At most 5.67 bits per eval (scored), 1.58 (verdict), in successful verdicts and on this channel only; failures (Error channel) and instructions (Side channels) come on top",
    cannot: "Free text",
    check: "cargo test -p arrow-core: output_space_is_at_most_51_states, output_le_900_bytes",
  },
  {
    part: "Error channel",
    trust: "The enclave writes one fixed error output and nothing on stderr; a trap or out-of-fuel run leaves no output",
    sees: "Two failure states on chain: ok:false (refund reason not_ok) and null. Scored mode has at least 52 outcomes and verdict mode 4 (2 bits); the 5.67 and 1.58 bits and the on-chain budget do not count null",
    cannot: "Carry data",
    check:
      "scripts/dev/stderr-harness.sh covers stderr and the fixed ok:false output. Seen locally, not a committed test: a 5 MB dataset with U+FDFA in the key column runs out of fuel when the buyer names it as key_column, so the buyer can steer between null and a verdict",
    flag: "RISKY",
  },
  {
    part: "Side channels",
    trust: "Not closed",
    sees: "time_ms and instructions on chain. Instructions depend on the dataset size and on the buyer's choice of key_column and date_column, so they can reveal a chosen column's non-empty and distinct counts on each eval; they are not counted in the 5.67-bit bound or the budget",
    cannot: "—",
    check: "TODO: the leak-bench timing measurement has not run, so no timing number is published",
    flag: "RISKY",
  },
  {
    part: "Decision correctness",
    trust: "Structural gates and the LLM",
    sees: "—",
    cannot: "The LLM cannot produce BUY unless the structural gates pass",
    check: "llm_cannot_buy_without_structural_gates in cargo test -p arrow-core. The quality bench has not run (TODO). Semantic injection on structurally valid data is an open risk",
    flag: "RISKY",
  },
  {
    part: "Buyer viewing key",
    trust: "The buyer's EOA signature over a domain-bound message",
    sees: "—",
    cannot: "—",
    check: "Any site that obtains the same signature can derive the key; an EOA is required (EIP-1271 wallets are not deterministic)",
    flag: "RISKY",
  },
  {
    part: "After purchase",
    trust: "Buyer",
    sees: "All data",
    cannot: "—",
    check: "Out of scope (resale is not prevented)",
    flag: "NOT PROVEN",
  },
  {
    part: "Time guard",
    trust: "The host clock of the OutLayer worker",
    sees: "—",
    cannot: "—",
    check: "The enclave writes an error output when the block timestamp is more than 90 s (eval) or 60 s (release) old; the clock itself is not attested",
    flag: "RISKY",
  },
  {
    part: "Leak budget",
    trust: "The contract counter",
    sees: "—",
    cannot: "—",
    check: "evals_used rises inside mt_on_transfer and never falls, not even on a refund: a refunded eval still burns budget. A buyer can burn a listing's budget with failing evals",
    flag: "RISKY",
  },
  {
    part: "OutLayer on mainnet",
    trust: "Its owners; the contract was upgraded this week",
    sees: "—",
    cannot: "—",
    check: "The program hash is pinned in the listing, the platform underneath it can still change",
    flag: "RISKY",
  },
  {
    part: "Refund destination",
    trust: "intents.near's own mt_resolve_transfer",
    sees: "—",
    cannot: "—",
    check:
      "Refunded to your NEAR Intents balance. Moving it back to a Base wallet is a separate 1Click withdrawal. Refunds by mt_resolve_transfer are shown on mainnet with a spike contract; a refund from the Arrow contract on mainnet is still to do",
    flag: "TODO",
  },
  {
    part: "HTTP 402 wrapper",
    trust: "Nothing: it carries no payment",
    sees: "—",
    cannot: "Move funds",
    check: "accepts is empty on purpose; payment goes through NEAR Intents. A live curl against the hosted site is still to do",
    flag: "TODO",
  },
  {
    part: "40-row sample to NEAR AI",
    trust: "TLS to the NEAR AI gateway (no E2EE)",
    sees: "The sampled rows leave the enclave to the model TEE",
    cannot: "—",
    check: "Stated here and in the README; see the LLM row",
  },
  {
    part: "Program bytes",
    trust: "Hosting of the wasm file (hash-pinned)",
    sees: "—",
    cannot: "Swap the program: the hash is pinned",
    check: "Availability depends on the host staying reachable, e.g. a public repository",
    flag: "RISKY",
  },
];
