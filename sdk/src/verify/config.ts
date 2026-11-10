// verify settings (WS4-T13). The two hash semantics values are explained in tasks/WS-4.md (T13) and DEC O-03.
//
// "source-read":   input_hash / output_hash are read from the worker source (sha256 of the input string, sha256 of the
//                  serde_json output). Row I1 is informational and the input-hash part of R3 is a detail only.
// "confirmed-s1b": gate S1-b item (5) confirmed it on a live run. Row I1 becomes REQUIRED and a mismatching input hash
//                  makes R3 NOT PROVEN. WS-1 flips this constant at K0.
export type HashSemantics = "source-read" | "confirmed-s1b";
export const INPUT_OUTPUT_HASH_SEMANTICS: HashSemantics = "source-read";

/** Model the enclave calls (the enclave's fixed model, DEC I-*); only used to fetch the current endpoint state for N1. */
export const NEAR_AI_MODEL = "Qwen/Qwen3.8-27B";
export const NEAR_AI_API = "https://cloud-api.near.ai";

/** The flag values of `--only`. Which rows each one selects is in engine.ts (ONLY_ROWS). */
export const ONLY_KINDS = ["e2e", "wasm", "attestation", "g3", "g1", "refund", "oneclick", "lock", "prelock"] as const;
export type OnlyKind = (typeof ONLY_KINDS)[number];

/** DEC Q-07 / H-07 targets printed by row I4. */
export const DOD_TARGETS = { listings: 3, evals: 12, purchases: 2, refunds: 1, inbound: 2, outbound: 1 } as const;
