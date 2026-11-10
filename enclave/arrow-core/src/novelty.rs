//! Novelty bands from an integer estimate of C_A = |A∩B|/|A| (DEC I-16). A = the seller's
//! distinct keys (known exactly in the enclave), B = the buyer's keys (only its signature).
//! Bands: ≥80% → 1, ≥60% → 2, ≥40% → 3, ≥20% → 4, else 5. No floating point.
//!
//! Two estimators (revised WS-3 decision, 2026-11-10; the card's §2.9 formula alone is badly
//! biased when |B| ≫ |A|, e.g. |B| = 5|A| with 10% overlap lands within ±1 band only ~42% of the
//! time, because it depends on c − j only):
//! - c ≥ 64 (most of B is inside A): C_A = j·c / D, D = c·(128 + j) − 128·j (WS-3 §2.9).
//! - c < 64: C_A = (c/128)·|B̂| / |A| with the k-min estimate |B̂| = 128·P/Σm − 1, i.e.
//!   C_A = c·(128·P − Σm) / (128·Σm·|A|).
//!
//! A simulation of both (400 trials per cell, |A| = 1000) is summarized in the commit message.

use crate::minhash::{Counts, K, P};

const BANDS: [(u128, u8); 4] = [(80, 1), (60, 2), (40, 3), (20, 4)];

/// The band for num/den, i.e. the first p with 100·num ≥ p·den.
fn band(num: u128, den: u128) -> u8 {
    if den == 0 {
        return 1;
    }
    let x = num.saturating_mul(100);
    BANDS.iter().find(|(p, _)| x >= den.saturating_mul(*p)).map_or(5, |(_, b)| *b)
}

/// None = the buyer sent no signature (novelty shows as 3 and the gate is skipped).
/// A signature without a usable key column (or without counts) is 1: novelty cannot be shown.
pub fn novelty(has_sig: bool, key_found: bool, counts: Option<Counts>) -> Option<u8> {
    if !has_sig {
        return None;
    }
    let Some(Counts { j, c, n_a, sum_m }) = counts.filter(|_| key_found) else {
        return Some(1);
    };
    if n_a == 0 {
        return Some(1);
    }
    if c == 0 {
        return Some(5);
    }
    let k = K as u128;
    let (j, c) = (u128::from(j), u128::from(c));
    if c >= 64 {
        // D = c·(128 + j) − 128·j ≥ 0 because c ≥ j; D ≤ j·c means C_A ≥ 1.
        let jc = j.saturating_mul(c);
        let d = c.saturating_mul(k.saturating_add(j)).saturating_sub(k.saturating_mul(j));
        if d <= jc {
            return Some(1);
        }
        return Some(band(jc, d));
    }
    let num = c.saturating_mul(k.saturating_mul(u128::from(P)).saturating_sub(sum_m));
    let den = k.saturating_mul(sum_m).saturating_mul(u128::from(n_a));
    Some(band(num, den))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::minhash::{counts, key_hash, signature};

    fn cnt(j: u8, c: u8, n_a: u32, sum_m: u128) -> Counts {
        Counts { j, c, n_a, sum_m }
    }

    #[test]
    fn no_signature_is_none() {
        assert_eq!(novelty(false, true, Some(cnt(1, 1, 1, 1))), None);
    }

    #[test]
    fn novelty_missing_key_column_is_1() {
        assert_eq!(novelty(true, false, None), Some(1));
        assert_eq!(novelty(true, false, Some(cnt(0, 0, 10, 1))), Some(1));
        assert_eq!(novelty(true, true, None), Some(1));
        assert_eq!(novelty(true, true, Some(cnt(0, 3, 0, 1))), Some(1));
    }

    #[test]
    fn novelty_band_boundaries() {
        let n = |j, c, n_a, s| novelty(true, true, Some(cnt(j, c, n_a, s))).unwrap();
        assert_eq!(n(0, 0, 10, 1), 5);
        assert_eq!(n(128, 128, 10, 1), 1);
        // c ≥ 64 branch, exactly on the boundaries:
        // j=64, c=128: D = 16384, jc = 8192 → 50% → 3
        assert_eq!(n(64, 128, 10, 1), 3);
        // j=c → D = jc → C_A = 1
        assert_eq!(n(70, 70, 10, 1), 1);
        // c = 64, j = 16: D = 64·144 − 2048 = 7168, jc = 1024 → 14.3% → 5
        assert_eq!(n(16, 64, 10, 1), 5);
        // the integer rule against an independent restatement, every (j ≤ c, c ≥ 64)
        for c in 64..=128u8 {
            for j in 0..=c {
                let (ji, ci) = (i64::from(j), i64::from(c));
                let d = ci * (128 + ji) - 128 * ji;
                let pct = 100 * ji * ci;
                let want = if ji * ci >= d { 1 } else if pct >= 80 * d { 1 } else if pct >= 60 * d { 2 } else if pct >= 40 * d { 3 } else if pct >= 20 * d { 4 } else { 5 };
                assert_eq!(n(j, c, 10, 1), want, "j={j} c={c}");
            }
        }
        // c < 64 branch: C_A = c·(128P − S)/(128·S·n_a). Pick S so that 128P − S = 128·S·n_a·x/c.
        // With S = 128P/(1 + m): (128P − S)/S = m. Then C_A = c·m/(128·n_a).
        let p = u128::from(P);
        let s_for = |m: u128| 128 * p / (1 + m);
        // c = 32, n_a = 1000, m = 4000 → C_A = 32·4000/128000 = 1.0 → 1 (floor error makes S slightly small → ≥)
        assert_eq!(n(0, 32, 1000, s_for(4000)), 1);
        // m = 3200 → 0.8 exactly (S rounded down → estimate ≥ 0.8) → 1; m = 3100 → 0.775 → 2
        assert_eq!(n(0, 32, 1000, s_for(3200)), 1);
        assert_eq!(n(0, 32, 1000, s_for(3100)), 2);
        assert_eq!(n(0, 32, 1000, s_for(800)), 4); // 0.2 → 4
        assert_eq!(n(0, 32, 1000, s_for(790)), 5);
        // S ≥ 128P (e.g. the empty signature) → estimate 0 → 5
        assert_eq!(n(0, 1, 1000, 128 * u128::from(u64::MAX)), 5);
        // S = 0 cannot come from a real signature; it saturates to the top band
        assert_eq!(n(0, 1, 1000, 0), 1);
    }

    fn keys(prefix: &str, range: std::ops::Range<u32>) -> Vec<String> {
        range.map(|i| format!("{prefix}{i}")).collect()
    }

    fn band_for(inter: u32, n_a: u32) -> u8 {
        band(u128::from(inter), u128::from(n_a))
    }

    /// X12-U1: a reseller who prefixes or suffixes every key with an invisible character still
    /// meets the buyer's own list: novelty 1, not 5.
    #[test]
    fn invisible_characters_do_not_fake_novelty() {
        let b = keys("ACME-", 0..1000);
        let sig = signature(b.iter().map(String::as_str)).unwrap();
        let tricks: [fn(&str) -> String; 4] = [
            |k| format!("\u{200B}{k}"),
            |k| format!("{k}\u{2060}"),
            |k| k.replacen('A', "A\u{FE0F}", 1),
            |k| format!("\u{E0020}{k}\u{E007F}"),
        ];
        for (i, t) in tricks.iter().enumerate() {
            let base: Vec<u64> = b.iter().filter_map(|k| key_hash(&t(k))).collect();
            assert_eq!(novelty(true, true, Some(counts(&base, &sig).unwrap())), Some(1), "trick {i}");
        }
    }

    /// R2-3: the same with accented keys, the invisible character placed between the letter and its
    /// combining mark (which blocked NFKC composition before the deletion moved ahead of it).
    #[test]
    fn invisible_mark_split_does_not_fake_novelty() {
        let b = keys("José-", 0..1000);
        let sig = signature(b.iter().map(String::as_str)).unwrap();
        let base: Vec<u64> = b.iter().filter_map(|k| key_hash(&k.replacen('é', "e\u{200B}\u{301}", 1))).collect();
        assert_eq!(novelty(true, true, Some(counts(&base, &sig).unwrap())), Some(1));
    }

    /// Deterministic key sets: |A| = 1000, |B| ∈ {100, 1000, 5000}, |A∩B| = pct · min(|A|, |B|).
    /// All within ±1 band; 0% exact; B ⊂ A and A = B exact. (A ⊂ B with |B| = 5|A| is exact here,
    /// but by simulation only in ~85% of random sets: k = 128 limits accuracy when |B| ≫ |A|.)
    #[test]
    fn containment_estimator_sanity() {
        for b_size in [100u32, 1000, 5000] {
            for pct in [0u32, 30, 85, 100] {
                let a = keys("k", 0..1000);
                let inter = pct * b_size.min(1000) / 100;
                let mut b = keys("k", 0..inter);
                b.extend(keys("z", 0..(b_size - inter)));
                let base: Vec<u64> = a.iter().filter_map(|k| key_hash(k)).collect();
                let sig = signature(b.iter().map(String::as_str)).unwrap();
                let got = novelty(true, true, Some(counts(&base, &sig).unwrap())).unwrap();
                let want = band_for(inter, 1000);
                if pct == 0 || pct == 100 {
                    assert_eq!(got, want, "|B|={b_size} pct={pct}");
                } else {
                    assert!((i16::from(got) - i16::from(want)).abs() <= 1, "|B|={b_size} pct={pct} got={got} want={want}");
                }
            }
        }
    }
}
