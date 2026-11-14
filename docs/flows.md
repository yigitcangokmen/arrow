# Arrow: what-if flows

Three failure paths, drawn with Noor and Kai from the [README story](../README.md#how-it-works). None of them is part of the recorded mainnet run; an enclave failure is, as [story step 5](../README.md#5-listing-3-fails). Each one names the [JUDGES](../JUDGES.md#claims) row that checks it; the row holds its label. What you see on your side, and where your money is, is in the README [failure table](../README.md#if-something-fails).

## 1. The file is swapped before a purchase settles

J#14; [hash binding](design.md#hash-binding).

```mermaid
sequenceDiagram
  autonumber
  participant Kai as Kai (buyer)
  participant Market as Arrow contract
  participant Program as Arrow program
  participant Host as Blob host
  participant Noor as Noor (seller)
  Note over Kai: the CLI hashes the file<br/>before paying, so the swap<br/>has to land after that check
  Kai->>Market: buy the listing, 2.00
  Noor->>Host: swaps in<br/>another file
  Market->>Program: request_execution<br/>(release)
  Program->>Host: fetch the ciphertext
  Note over Program: sha256 differs from<br/>the hash sealed with<br/>the key: no key out
  Program-->>Market: a sealed zero key and<br/>h, the new hash (resume)
  Note over Market: h differs from<br/>the listing hash
  Market-->>Kai: 2.00 back in full,<br/>reason hash_mismatch
```

## 2. A listing sealed to an older program

J#57; key change: [keys](design.md#keys).

```mermaid
sequenceDiagram
  autonumber
  participant Kai as Kai (buyer)
  participant Intents as intents.near
  participant Market as Arrow contract
  Note over Market: set_program moved the contract to a new wasm hash<br/>after the listing was sealed to the old one
  Kai->>Intents: signed intent: 0.25 to inspect the listing
  Intents->>Market: mt_on_transfer
  Note over Market: panics with E13 before any state change
  Market-->>Intents: the call failed
  Intents-->>Kai: mt_resolve_transfer returns the whole 0.25<br/>to his NEAR Intents balance
```

## 3. The leak budget is spent, sales stay open

J#15; [leak budget](design.md#leak-budget).

```mermaid
sequenceDiagram
  autonumber
  participant Kai as Kai (buyer)
  participant Market as Arrow contract
  participant Program as Arrow program (OutLayer TDX)
  Note over Market: evals_used has reached max_evals
  Kai->>Market: leak_budget (view)
  Note over Kai: the CLI stops here:<br/>buy-only listing, nothing paid
  Kai->>Market: an inspection paid anyway, 0.25
  Note over Market: panics with E09, so the token<br/>contract returns the whole 0.25
  Kai->>Market: buy, 2.00
  Market->>Program: request_execution (release)
  Program-->>Market: data key sealed to Kai's key (resume)
  Market-->>Kai: purchase settles: sales stay open
```
