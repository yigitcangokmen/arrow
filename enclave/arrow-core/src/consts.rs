//! Core constants shared by the enclave and its tests.

/// OutLayer blockchain-mode output limit (DEC I-07).
pub const MAX_OUTPUT_BYTES: usize = 900;
/// Size we aim for (DEC I-07).
pub const TARGET_OUTPUT_BYTES: usize = 400;
/// eciesjs 0.4 default profile: ephemeral pk 65 + nonce 16 + tag 16.
pub const ECIES_OVERHEAD: usize = 97;
/// ceil(1000 * log2(51)): 50 scored states + the error state (DEC A.1 G1, contract uses the same).
pub const BITS_PER_EVAL_MILLI_SCORED: u32 = 5673;
/// ceil(1000 * log2(3)): PASS, BUY and the error state.
pub const BITS_PER_EVAL_MILLI_VERDICT: u32 = 1585;

/// Dataset limits (DEC I-13). The blob size is checked again on download (arrow-tee http.rs).
pub const MAX_BLOB: usize = 5 * 1024 * 1024;
pub const MAX_ROWS: u32 = 200_000;
pub const MAX_COLS: usize = 64;

/// Seeded sample size sent to the LLM (DEC I-06; 20 if the measured p95 exceeds 25 s).
pub const SAMPLE_ROWS: u32 = 40;
/// Hard ceilings for one sampled row (DEC I-06).
pub const MAX_CELL_CHARS: usize = 200;
pub const MAX_ROW_BYTES: usize = 1024;
/// Fixed LLM call parameters (DEC I-05, agent guide invariant 4).
pub const LLM_MAX_TOKENS: u32 = 64;
/// Largest NEAR AI response body the enclave parses.
pub const MAX_LLM_RESPONSE: usize = 64 * 1024;
