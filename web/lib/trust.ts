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
    sees: "Whoever hosts the file sees each downloader's IP address and user agent. The exact plaintext size is public (ciphertext length minus 40 bytes), as are the column names and the row count",
    cannot: "Decrypt",
    check:
      "blob_sha256 is on chain and the enclave checks it before reading: shown on mainnet on 14 Nov (listings #1-#3; purchase #1 has listing.blob_sha256 == purchase.h == eval.h, tx Eaj1mPrtdNBWX6p49aDy9M797dsLZ4hyyi51xaKvyAR6). This site keeps sellers' ciphertext in its blob store only while the hosted demo runs; a daily job deletes a stored ciphertext that no Arrow listing points to, 24 hours after upload",
  },
  {
    part: "Program key / PROTECTED_MASTER",
    trust: "OutLayer keystore (TDX) and the shared OutLayer master",
    sees: "Inside the TEE",
    cannot: "Release to a non-Arrow caller (tested); release to an unpinned wasm (on mainnet the secret row's access rule is WasmHash 6ad7fed4… AND caller arrow-market.near, never changed since it was made)",
    check:
      "WasmHash and Predecessor conditions are configured; in-wasm network allowlist. npm run verify -- --network mainnet row I5 reads the rule from chain: one row on outlayer.near, And[WasmHash 6ad7fed4…, Predecessor arrow-market.near], created_at == updated_at (PROVEN on 14 Nov). Negative tests: an attacker account calling OutLayer directly is refused (testnet tx smm9T86m…, mainnet tx Bzzg22r9…). Both call the pinned wasm, so they test the Predecessor condition only; no transaction tests WasmHash",
    flag: "NOT PROVEN",
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
    sees: "The encrypted blobs it hosts, and the IP address, 0x address and listing of every payment relayed through /api/relay",
    cannot: "The plan after the lock, not yet a fact: read data, take funds, or change the contract or wasm hash",
    check: "Live on mainnet; not locked yet, so the team can still change it: there is no lock transaction, and arrow-market.near still has an access key. The contract is meant to own itself with no access keys; npm run verify -- --network mainnet (row R6) shows it once it is done",
    flag: "TODO",
  },
  {
    part: "Arrow web app (served JavaScript)",
    trust: "Whoever deploys the site (a modified deploy is not detectable from the page)",
    sees: "Everything the page handles: the file you encrypt and its key, your criteria, your own list's keys, and the signature that derives your viewing key",
    cannot: "—",
    check:
      "One viewing-key signature derives every past and future verdict key of that wallet for the domain, so served JavaScript that captures it reads them all. The pages run only scripts that carry the page's per-request nonce ('strict-dynamic', no 'unsafe-inline' or 'unsafe-eval'): that stops an injected script, not a modified deploy. For sensitive data use the CLI",
    flag: "RISKY",
  },
  {
    part: "Relayer account",
    trust: "Whoever holds the keys of arrow-relayer.arrowhq.near (the team)",
    sees: "The intents it relays: signer, msg, IP",
    cannot: "Spend or move user funds: the relayer holds none",
    check:
      "The server's relayer key is a function-call key limited to execute_intents on intents.near. The same account also holds a FullAccess key; whoever holds it can drain the relayer's gas or stop /api/relay. The lock of the market contract does not cover this account. The relay's rate limits are per server instance and protect only the relayer's gas: across instances the worst case is about 0.34 NEAR of gas (its balance down to the 0.65 NEAR floor, then the hosted relay pauses) and no user funds; a signed payment still runs once on intents.near",
    flag: "RISKY",
  },
  {
    part: "Gas tank",
    trust: "The operator (tops it up) and OutLayer's NEAR charge",
    sees: "—",
    cannot: "—",
    check:
      "Every eval costs the contract's tank a NEAR charge, whether or not it succeeds. A failed eval keeps the treasury's 10% of its fee, which goes to the treasury and not the tank, so forced failures still run the tank down and op=eval is refused until someone refills it. At most 5 evals are in flight per listing, and the relay limits each signer per server instance",
    flag: "RISKY",
  },
  {
    part: "NEAR AI API key (inside the OutLayer secret)",
    trust: "Billing",
    sees: "Usage volume",
    cannot: "See content",
    check:
      "The mainnet inference key is the NEAR Builders hackathon key. It cannot be topped up and its expiry is not published; if it runs out, evals fail and are refunded less the treasury's 10% share of their fee.",
    flag: "RISKY",
  },
  {
    part: "1Click and the PoA bridge (Intents Technology)",
    trust: "Short custody during swaps. Base USDC is a bridged token (omft.near) that 1Click swaps into native NEAR USDC, the only token the market accepts; a Solana withdrawal is the reverse swap. The swap is a trust step",
    sees: "Swap transactions",
    cannot: "—",
    check: "1Click /v0/status. Paid inbound ran once on mainnet (2 USDC from Base); the outbound Solana withdrawal is a dry quote only. Custody is not shown",
    flag: "NOT PROVEN",
  },
  {
    part: "Output channel",
    trust: "Schema and rule composition",
    sees: "At most 5.68 bits per eval (scored), 1.59 (verdict), counting the one error output, on this channel only; null (Error channel) and instructions (Side channels) come on top",
    cannot: "Free text",
    check: "cargo test -p arrow-core: output_space_is_at_most_51_states, output_le_900_bytes",
  },
  {
    part: "Error channel",
    trust: "The enclave writes one fixed error output and nothing on stderr; a trap or out-of-fuel run leaves no output",
    sees: "Two failure states on chain: ok:false (refund reason not_ok) and null. Scored mode has at least 52 outcomes and verdict mode 4 (2 bits); the 5.68 and 1.59 bits and the on-chain budget do not count null",
    cannot: "Carry data",
    check:
      "scripts/dev/stderr-harness.sh covers stderr, the fixed ok:false output and out-of-memory. A key column that expands under normalization (U+FDFA) ends as ok:false, not out of fuel (key_column_normalization_is_capped), and the injection scan reads only the cell prefix the prompt shows. null still comes from OutLayer or worker failures",
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
    check:
      "The enclave writes an error output when the block timestamp is more than 90 s (eval) or 45 s (release) old; the clock itself is not attested. A release output OutLayer publishes after the yield window is refused, but its k (sealed to the buyer) is public while the buyer keeps the refund",
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
      "Refunded to your NEAR Intents balance. Moving it back to a Base wallet is a separate 1Click withdrawal. The Arrow contract refunded a failed eval on mainnet (arrow_refund not_ok, mainnet tx 7Gnw32jEcgUwmhdH2T4YtcJoUPS6hdetpTmWpoFqRcos); refunds by mt_resolve_transfer were shown on mainnet before that with a spike contract",
  },
  {
    part: "HTTP 402 wrapper",
    trust: "Nothing: it carries no payment",
    sees: "—",
    cannot: "Move funds",
    check: "accepts is empty on purpose; payment goes through NEAR Intents. curl -i 'https://arrow-market.vercel.app/api/x402/1' answers 402 with X-Arrow-Listing arrow-market.near/1 and an empty accepts",
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
    check: "Served from testnet FastFS (test.fastfs.io). Availability depends on that host staying reachable; once the market is locked, the URL cannot change",
    flag: "RISKY",
  },
];

/** The anchor of a trust-table row on the home page ("Output channel" -> "trust-row-output-channel"). */
export const trustRowId = (part: string): string => `trust-row-${part.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
