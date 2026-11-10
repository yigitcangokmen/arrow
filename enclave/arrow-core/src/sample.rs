//! Seeded row sample (DEC I-06). The seed is the contract's `env::random_seed()` for this eval,
//! so the seller cannot know which rows the LLM will see when writing the data.

use std::collections::BTreeSet;

use rand_chacha::rand_core::{RngCore, SeedableRng};
use rand_chacha::ChaCha20Rng;
use sha2::{Digest, Sha256};

fn rng(seed: &[u8; 32]) -> ChaCha20Rng {
    let mut h = Sha256::new();
    h.update(b"arrow/sample/v1");
    h.update(seed);
    ChaCha20Rng::from_seed(h.finalize().into())
}

/// Uniform in 0..m by rejection (no modulo bias). m must be >= 1.
fn uniform(r: &mut ChaCha20Rng, m: u64) -> u64 {
    let Some(zone) = u64::MAX.checked_div(m).and_then(|q| q.checked_mul(m)) else {
        return 0;
    };
    loop {
        let v = r.next_u64();
        if v < zone {
            return v.checked_rem(m).unwrap_or(0);
        }
    }
}

/// `k` distinct row indices out of `n` (all of them if n <= k), ascending. Floyd's algorithm.
pub fn sample_indices(seed: &[u8; 32], n: u32, k: u32) -> Vec<u32> {
    let Some(start) = n.checked_sub(k).filter(|_| n > k) else {
        return (0..n).collect();
    };
    let mut r = rng(seed);
    let mut set = BTreeSet::new();
    for j in start..n {
        let t = u32::try_from(uniform(&mut r, u64::from(j).saturating_add(1))).unwrap_or(j);
        if !set.insert(t) {
            set.insert(j);
        }
    }
    set.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::consts::SAMPLE_ROWS;

    #[test]
    fn same_seed_same_40_rows() {
        let seed = [9u8; 32];
        let a = sample_indices(&seed, 10_000, SAMPLE_ROWS);
        let b = sample_indices(&seed, 10_000, SAMPLE_ROWS);
        assert_eq!(a.len(), 40);
        assert_eq!(a, b);
    }

    #[test]
    fn different_seed_different_rows() {
        let a = sample_indices(&[1u8; 32], 10_000, 40);
        let b = sample_indices(&[2u8; 32], 10_000, 40);
        assert_ne!(a, b);
    }

    #[test]
    fn n_le_k_takes_all() {
        assert_eq!(sample_indices(&[0u8; 32], 12, 40), (0..12).collect::<Vec<_>>());
        assert_eq!(sample_indices(&[0u8; 32], 40, 40), (0..40).collect::<Vec<_>>());
        assert!(sample_indices(&[0u8; 32], 0, 40).is_empty());
    }

    #[test]
    fn indices_unique_sorted_in_range() {
        let mut r = ChaCha20Rng::seed_from_u64(11);
        for _ in 0..10_000 {
            let n = r.next_u32() % 300;
            let k = 1 + r.next_u32() % 60;
            let mut seed = [0u8; 32];
            r.fill_bytes(&mut seed);
            let s = sample_indices(&seed, n, k);
            assert_eq!(s.len() as u32, n.min(k));
            assert!(s.windows(2).all(|w| w[0] < w[1]));
            assert!(s.iter().all(|&i| i < n));
        }
    }
}
