//! Output space and wasm output JSON (DEC I-07, I-08, I-09).
//!
//! scored: idx = (verdict==BUY)*25 + (fit-1)*5 + (novelty-1), 0..=49.
//! verdict mode: PASS = 0, BUY = 1. A guard trip is PASS·1·1 = idx 0 in both modes.
//! Errors are a separate output (`ERR_JSON`), never an index.

use crate::consts::MAX_OUTPUT_BYTES;
use crate::err::ArrowErr;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Verdict,
    Scored,
}

impl std::str::FromStr for Mode {
    type Err = ArrowErr;
    fn from_str(s: &str) -> Result<Mode, ArrowErr> {
        match s {
            "verdict" => Ok(Mode::Verdict),
            "scored" => Ok(Mode::Scored),
            _ => Err(ArrowErr::Input),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    Pass,
    Buy,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Score {
    pub verdict: Verdict,
    pub fit: u8,
    pub novelty: u8,
}

pub const GUARD_SCORE: Score = Score { verdict: Verdict::Pass, fit: 1, novelty: 1 };

pub const ERR_JSON: &[u8] = br#"{"v":1,"ok":false}"#;

/// Err if fit or novelty is outside 1..=5 (scored mode checks both; verdict mode ignores them).
pub fn state_index(mode: Mode, s: &Score) -> Result<u8, ArrowErr> {
    let buy = u8::from(s.verdict == Verdict::Buy);
    match mode {
        Mode::Verdict => Ok(buy),
        Mode::Scored => {
            if !(1..=5).contains(&s.fit) || !(1..=5).contains(&s.novelty) {
                return Err(ArrowErr::Internal);
            }
            let f = s.fit.checked_sub(1).ok_or(ArrowErr::Internal)?;
            let n = s.novelty.checked_sub(1).ok_or(ArrowErr::Internal)?;
            buy.checked_mul(25)
                .and_then(|v| f.checked_mul(5).and_then(|fv| v.checked_add(fv)))
                .and_then(|v| v.checked_add(n))
                .ok_or(ArrowErr::Internal)
        }
    }
}

/// Inverse of `state_index` (tests and the bench `explain` tool). Verdict mode returns fit/novelty 0.
pub fn decode_state(mode: Mode, idx: u8) -> Option<Score> {
    match mode {
        Mode::Verdict => match idx {
            0 => Some(Score { verdict: Verdict::Pass, fit: 0, novelty: 0 }),
            1 => Some(Score { verdict: Verdict::Buy, fit: 0, novelty: 0 }),
            _ => None,
        },
        Mode::Scored => {
            if idx >= 50 {
                return None;
            }
            let verdict = if idx >= 25 { Verdict::Buy } else { Verdict::Pass };
            let rest = idx.checked_rem(25)?;
            let fit = rest.checked_div(5)?.checked_add(1)?;
            let novelty = rest.checked_rem(5)?.checked_add(1)?;
            Some(Score { verdict, fit, novelty })
        }
    }
}

fn is_b64(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=')
}

fn is_hex(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn finish(parts: &[&str]) -> Result<Vec<u8>, ArrowErr> {
    let out: Vec<u8> = parts.concat().into_bytes();
    if out.len() > MAX_OUTPUT_BYTES {
        return Err(ArrowErr::Output);
    }
    Ok(out)
}

/// `{"v":1,"ok":true,"r":"<b64>","h":"<hex>"}` (227 bytes with a 98-byte ECIES result).
pub fn out_eval(r_b64: &str, h_hex: &str) -> Result<Vec<u8>, ArrowErr> {
    if !is_b64(r_b64) || !is_hex(h_hex) {
        return Err(ArrowErr::Output);
    }
    finish(&[r#"{"v":1,"ok":true,"r":""#, r_b64, r#"","h":""#, h_hex, r#""}"#])
}

/// `{"v":1,"ok":true,"k":"<b64>","h":"<hex>"}` (267 bytes with a 129-byte ECIES key).
pub fn out_release(k_b64: &str, h_hex: &str) -> Result<Vec<u8>, ArrowErr> {
    if !is_b64(k_b64) || !is_hex(h_hex) {
        return Err(ArrowErr::Output);
    }
    finish(&[r#"{"v":1,"ok":true,"k":""#, k_b64, r#"","h":""#, h_hex, r#""}"#])
}

/// `{"v":1,"ok":true,"pk":"04<128 hex>"}` (155 bytes).
pub fn out_derive(pk_hex: &str) -> Result<Vec<u8>, ArrowErr> {
    if !is_hex(pk_hex) {
        return Err(ArrowErr::Output);
    }
    finish(&[r#"{"v":1,"ok":true,"pk":""#, pk_hex, r#""}"#])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::consts::{BITS_PER_EVAL_MILLI_SCORED, BITS_PER_EVAL_MILLI_VERDICT, ECIES_OVERHEAD};
    use std::collections::HashSet;

    fn all_scores() -> Vec<Score> {
        let mut v = Vec::new();
        for verdict in [Verdict::Pass, Verdict::Buy] {
            for fit in 1..=5 {
                for novelty in 1..=5 {
                    v.push(Score { verdict, fit, novelty });
                }
            }
        }
        v
    }

    #[test]
    fn output_space_is_at_most_51_states() {
        let mut seen = HashSet::new();
        for s in all_scores() {
            let idx = state_index(Mode::Scored, &s).unwrap();
            assert!(idx <= 49);
            assert_eq!(decode_state(Mode::Scored, idx), Some(s));
            seen.insert(idx);
        }
        assert_eq!(seen.len(), 50);
        // + the error output = 51 states.
        assert!(seen.len() + 1 <= 51);

        let mut vseen = HashSet::new();
        for s in all_scores() {
            vseen.insert(state_index(Mode::Verdict, &s).unwrap());
        }
        assert_eq!(vseen.len(), 2);
        assert!(vseen.len() + 1 <= 3);
        assert_eq!(decode_state(Mode::Scored, 50), None);
        assert_eq!(decode_state(Mode::Verdict, 2), None);
    }

    #[test]
    fn state_index_rejects_out_of_range() {
        for (fit, novelty) in [(0, 1), (6, 1), (1, 0), (1, 6)] {
            let s = Score { verdict: Verdict::Buy, fit, novelty };
            assert_eq!(state_index(Mode::Scored, &s), Err(ArrowErr::Internal));
        }
    }

    #[test]
    fn guard_maps_to_idx0() {
        assert_eq!(state_index(Mode::Scored, &GUARD_SCORE).unwrap(), 0);
        assert_eq!(state_index(Mode::Verdict, &GUARD_SCORE).unwrap(), 0);
    }

    fn b64_len(n: usize) -> usize {
        n.div_ceil(3) * 4
    }

    #[test]
    fn output_le_900_bytes() {
        let h = "a".repeat(64);
        let r = "A".repeat(b64_len(ECIES_OVERHEAD + 1));
        let k = "A".repeat(b64_len(ECIES_OVERHEAD + 32));
        let pk = format!("04{}", "b".repeat(128));
        let e = out_eval(&r, &h).unwrap();
        let rel = out_release(&k, &h).unwrap();
        let d = out_derive(&pk).unwrap();
        assert_eq!((e.len(), rel.len(), d.len(), ERR_JSON.len()), (227, 267, 155, 18));
        for o in [&e, &rel, &d] {
            assert!(o.len() <= MAX_OUTPUT_BYTES);
            assert!(o.len() <= crate::consts::TARGET_OUTPUT_BYTES);
            serde_json::from_slice::<serde_json::Value>(o).unwrap();
        }
        assert_eq!(out_eval(&"A".repeat(900), &h), Err(ArrowErr::Output));
        assert_eq!(out_eval("a\"b", &h), Err(ArrowErr::Output));
        assert_eq!(out_derive("04XY"), Err(ArrowErr::Output));
    }

    #[test]
    fn err_output_exact() {
        assert_eq!(ERR_JSON, br#"{"v":1,"ok":false}"#);
    }

    #[test]
    fn bits_per_eval_milli_matches_contract() {
        assert_eq!((1000.0 * 51f64.log2()).ceil() as u32, BITS_PER_EVAL_MILLI_SCORED);
        assert_eq!((1000.0 * 3f64.log2()).ceil() as u32, BITS_PER_EVAL_MILLI_VERDICT);
    }

    #[test]
    fn mode_from_str() {
        assert_eq!("scored".parse::<Mode>(), Ok(Mode::Scored));
        assert_eq!("verdict".parse::<Mode>(), Ok(Mode::Verdict));
        assert_eq!("Scored".parse::<Mode>(), Err(ArrowErr::Input));
    }
}
