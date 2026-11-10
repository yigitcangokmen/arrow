//! MinHash, k = 128 (DEC I-16, I-17; binding definition in fixtures/README.md):
//! x = BE_u64(sha256(normalize_key(key))[0..8]); h_i(x) = (a_i·x + b_i) mod (2^61 − 1) in 128 bits,
//! x not reduced first; the signature is the per-i minimum. Keys that normalize to "" are skipped;
//! the empty set's signature is u64::MAX × 128. The params file is compiled in (part of the wasm hash).

use std::sync::OnceLock;

use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::err::ArrowErr;
use crate::normalize::normalize_key;

pub const K: usize = 128;
pub const P: u64 = (1u64 << 61) - 1;
/// One signature as written in criteria: 128 × 16 lowercase hex.
pub const SIG_HEX_LEN: usize = K * 16;

pub struct Params {
    pub a: [u64; K],
    pub b: [u64; K],
}

#[derive(Deserialize)]
struct ParamsFile {
    k: usize,
    prime: String,
    a: Vec<String>,
    b: Vec<String>,
}

const PARAMS_JSON: &str = include_str!("../../../fixtures/minhash-params.json");

fn to_arr(v: &[String]) -> Option<[u64; K]> {
    let mut out = [0u64; K];
    if v.len() != K {
        return None;
    }
    for (o, s) in out.iter_mut().zip(v.iter()) {
        let x: u64 = s.parse().ok()?;
        if x >= P {
            return None;
        }
        *o = x;
    }
    Some(out)
}

fn load() -> Option<Params> {
    let f: ParamsFile = serde_json::from_str(PARAMS_JSON).ok()?;
    if f.k != K || f.prime != P.to_string() {
        return None;
    }
    let p = Params { a: to_arr(&f.a)?, b: to_arr(&f.b)? };
    if p.a.contains(&0) {
        return None;
    }
    Some(p)
}

pub fn params() -> Result<&'static Params, ArrowErr> {
    static P_CELL: OnceLock<Option<Params>> = OnceLock::new();
    P_CELL.get_or_init(load).as_ref().ok_or(ArrowErr::Internal)
}

/// First 8 bytes of sha256(norm), big-endian. `norm` must already be normalized.
pub fn base_hash(norm: &str) -> u64 {
    let d = Sha256::digest(norm.as_bytes());
    let mut b = [0u8; 8];
    b.iter_mut().zip(d.iter()).for_each(|(o, x)| *o = *x);
    u64::from_be_bytes(b)
}

/// Normalizes and hashes one key; None if it normalizes to "".
pub fn key_hash(key: &str) -> Option<u64> {
    let n = normalize_key(key);
    (!n.is_empty()).then(|| base_hash(&n))
}

/// v mod P for any u64: 2^61 ≡ 1, so (low 61 bits) + (v >> 61) < 2^61 + 8 < 2P, then one subtraction.
fn fold(v: u64) -> u64 {
    let r = (v & P).wrapping_add(v >> 61);
    if r >= P {
        r.wrapping_sub(P)
    } else {
        r
    }
}

/// a·y mod P for a, y < 2^61 in u64 only, with 32-bit halves:
/// a·y = hh·2^64 + mid·2^32 + ll, 2^64 ≡ 8 and mid·2^32 ≡ (mid >> 29) + (mid mod 2^29)·2^32.
/// Bounds: hh < 2^58, mid < 2^62, ll < 2^64, so the sum is < 3·2^61 + 2^34 < 2^63 and no
/// wrapping op below can wrap.
fn mul_mod(a: u64, y: u64) -> u64 {
    let (ah, al) = (a >> 32, a & 0xffff_ffff);
    let (yh, yl) = (y >> 32, y & 0xffff_ffff);
    let hh = ah.wrapping_mul(yh);
    let mid = ah.wrapping_mul(yl).wrapping_add(al.wrapping_mul(yh));
    let ll = al.wrapping_mul(yl);
    let s = (hh << 3)
        .wrapping_add(mid >> 29)
        .wrapping_add((mid & 0x1fff_ffff) << 32)
        .wrapping_add(ll >> 61)
        .wrapping_add(ll & P);
    fold(s)
}

/// (a_i·x + b_i) mod P, x not reduced first (the value equals the 128-bit definition, since
/// a·x ≡ a·(x mod P)). u64-only: u128 `%` and `*` are software routines on wasm32, and with them
/// the 200k-key max case ran out of the 20e9 instruction limit (WS3-T11b, docs/perf.md).
pub fn perm(p: &Params, i: usize, x: u64) -> Option<u64> {
    Some(perm_reduced(*p.a.get(i)?, *p.b.get(i)?, fold(x)))
}

/// perm with x already reduced (xr = fold(x)), so a loop over the 128 (a, b) pairs folds x once.
/// a, b < P (checked when the params load), xr < P: mul_mod(..) + b < 2P < 2^62.
fn perm_reduced(a: u64, b: u64, xr: u64) -> u64 {
    fold(mul_mod(a, xr).wrapping_add(b))
}

fn signature_of_hashes<I: Iterator<Item = u64>>(xs: I) -> Result<[u64; K], ArrowErr> {
    let p = params()?;
    let mut sig = [u64::MAX; K];
    for x in xs {
        for (i, s) in sig.iter_mut().enumerate() {
            let v = perm(p, i, x).ok_or(ArrowErr::Internal)?;
            if v < *s {
                *s = v;
            }
        }
    }
    Ok(sig)
}

pub fn signature<'a, I: Iterator<Item = &'a str>>(keys: I) -> Result<[u64; K], ArrowErr> {
    signature_of_hashes(keys.filter_map(key_hash))
}

pub fn signature_hex(sig: &[u64; K]) -> String {
    sig.iter().map(|v| format!("{v:016x}")).collect()
}

/// Exactly 2048 lowercase hex chars (criteria `minhash`), else Err(Criteria).
pub fn parse_signature(hex: &str) -> Result<[u64; K], ArrowErr> {
    let b = hex.as_bytes();
    if b.len() != SIG_HEX_LEN || !b.iter().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(c)) {
        return Err(ArrowErr::Criteria);
    }
    let mut out = [0u64; K];
    for (o, chunk) in out.iter_mut().zip(b.chunks_exact(16)) {
        let s = std::str::from_utf8(chunk).map_err(|_| ArrowErr::Criteria)?;
        *o = u64::from_str_radix(s, 16).map_err(|_| ArrowErr::Criteria)?;
    }
    Ok(out)
}

/// j = #{i : minA[i] == m[i]} (Jaccard counter), c = #{i : some a has h_i(a) == m[i]} (B ∩ A
/// counter), n_a = |A| (exact, distinct seller keys), sum_m = Σ m[i] (the buyer signature's k-mins,
/// which estimate |B|).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Counts {
    pub j: u8,
    pub c: u8,
    pub n_a: u32,
    pub sum_m: u128,
}

/// One pass over the seller's distinct base hashes against the buyer's signature (WS-3 §2.9).
pub fn counts(seller_base: &[u64], buyer: &[u64; K]) -> Result<Counts, ArrowErr> {
    let p = params()?;
    let mut min_a = [u64::MAX; K];
    let mut hit_b = [false; K];
    for &x in seller_base {
        let xr = fold(x);
        let pairs = p.a.iter().zip(p.b.iter());
        for (((m, h), b), (&pa, &pb)) in min_a.iter_mut().zip(hit_b.iter_mut()).zip(buyer.iter()).zip(pairs) {
            let v = perm_reduced(pa, pb, xr);
            if v < *m {
                *m = v;
            }
            if v == *b {
                *h = true;
            }
        }
    }
    let j = min_a.iter().zip(buyer.iter()).filter(|(a, b)| a == b).count();
    let c = hit_b.iter().filter(|h| **h).count();
    let sum_m = buyer.iter().fold(0u128, |s, &m| s.saturating_add(u128::from(m)));
    Ok(Counts {
        j: u8::try_from(j).map_err(|_| ArrowErr::Internal)?,
        c: u8::try_from(c).map_err(|_| ArrowErr::Internal)?,
        n_a: u32::try_from(seller_base.len()).map_err(|_| ArrowErr::Internal)?,
        sum_m,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn params_parse_128() {
        let p = params().unwrap();
        assert_eq!(p.a.len(), 128);
        assert!(p.a.iter().chain(p.b.iter()).all(|&v| v < P));
        // derivation check for i = 0: a = BE_u64(sha256("arrow/minhash/v1/0")[0..8]) mod p
        let d = Sha256::digest(b"arrow/minhash/v1/0");
        let a0 = u64::from_be_bytes(d[..8].try_into().unwrap()) % P;
        let b0 = u64::from_be_bytes(d[8..16].try_into().unwrap()) % P;
        assert_eq!((p.a[0], p.b[0]), (if a0 == 0 { 1 } else { a0 }, b0));
    }

    #[test]
    fn perm_no_overflow_at_max() {
        let p = Params { a: [P - 1; K], b: [P - 1; K] };
        let want = ((u128::from(P - 1) * u128::from(u64::MAX) + u128::from(P - 1)) % u128::from(P)) as u64;
        assert_eq!(perm(&p, 0, u64::MAX), Some(want));
        assert_eq!(perm(&p, 127, u64::MAX), Some(want));
        assert_eq!(perm(&p, 128, 1), None);
    }

    #[test]
    fn perm_fold_equals_u128_rem() {
        // The Mersenne fold must give exactly (a·x + b) % P, including the edges around P.
        let mut s = 0x0123_4567_89ab_cdefu64;
        let mut next = || {
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            s
        };
        let edges = [0, 1, P - 1, P, P + 1, 2 * P, u64::MAX - 1, u64::MAX];
        for n in 0..200_000 {
            let (a, b) = (1 + next() % (P - 1), next() % P);
            let x = if n < edges.len() { edges[n] } else { next() };
            let p = Params { a: [a; K], b: [b; K] };
            let want = ((u128::from(a) * u128::from(x) + u128::from(b)) % u128::from(P)) as u64;
            assert_eq!(perm(&p, 5, x), Some(want), "a={a} b={b} x={x}");
        }
        for (a, b, x) in [(1, 0, P), (1, P - 1, 1), (P - 1, P - 1, u64::MAX), (P - 1, 0, P - 1)] {
            let p = Params { a: [a; K], b: [b; K] };
            let want = ((u128::from(a) * u128::from(x) + u128::from(b)) % u128::from(P)) as u64;
            assert_eq!(perm(&p, 0, x), Some(want));
        }
    }

    #[test]
    fn counts_identical_sets_j128_c128() {
        let keys: Vec<String> = (0..500).map(|i| format!("key-{i}")).collect();
        let sig = signature(keys.iter().map(String::as_str)).unwrap();
        let base: Vec<u64> = keys.iter().filter_map(|k| key_hash(k)).collect();
        let got = counts(&base, &sig).unwrap();
        assert_eq!((got.j, got.c, got.n_a), (128, 128, 500));
        assert_eq!(got.sum_m, sig.iter().map(|&m| u128::from(m)).sum::<u128>());
    }

    #[test]
    fn counts_disjoint_c0() {
        let a: Vec<u64> = (0..500).map(|i| key_hash(&format!("a-{i}")).unwrap()).collect();
        let sig = signature((0..500).map(|i| format!("b-{i}")).collect::<Vec<_>>().iter().map(String::as_str)).unwrap();
        let got = counts(&a, &sig).unwrap();
        assert_eq!((got.j, got.c), (0, 0));
    }

    #[test]
    fn empty_set_signature_is_all_ff() {
        let sig = signature(["", "  ", "\u{3000}"].into_iter()).unwrap();
        assert_eq!(signature_hex(&sig), "ffffffffffffffff".repeat(128));
    }

    #[test]
    fn signature_hex_roundtrip_and_rejects() {
        let sig = signature(["a", "b"].into_iter()).unwrap();
        let h = signature_hex(&sig);
        assert_eq!(h.len(), SIG_HEX_LEN);
        assert_eq!(parse_signature(&h).unwrap(), sig);
        assert_eq!(parse_signature(&h[..2032]), Err(ArrowErr::Criteria));
        assert_eq!(parse_signature(&h.to_uppercase()), Err(ArrowErr::Criteria));
        assert_eq!(parse_signature(&format!("{h}0")), Err(ArrowErr::Criteria));
    }

    #[test]
    fn counts_200k_keys_fast() {
        // Worst case for one eval: 200k distinct seller keys x 128 permutations.
        let base: Vec<u64> = (0..200_000u64).map(|i| i.wrapping_mul(0x9E37_79B9_7F4A_7C15)).collect();
        let sig = signature(["a", "b"].into_iter()).unwrap();
        let t = std::time::Instant::now();
        counts(&base, &sig).unwrap();
        let el = t.elapsed();
        if !cfg!(debug_assertions) {
            assert!(el.as_secs_f64() < 2.0, "{el:?}");
        }
    }

    #[test]
    fn signature_order_and_duplicates_independent() {
        let a = signature(["x", "y", "z"].into_iter()).unwrap();
        let b = signature(["Z", " y ", "x", "x", "X"].into_iter()).unwrap();
        assert_eq!(a, b);
    }
}
