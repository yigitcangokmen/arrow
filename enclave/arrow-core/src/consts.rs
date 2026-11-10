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
