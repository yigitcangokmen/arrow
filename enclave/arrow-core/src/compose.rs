//! Final score from the deterministic gates and the LLM vote (DEC I-08, I-15, I-16, I-18).
//! The LLM can lower fit and can vote BUY, but BUY needs every structural gate: fit_rule 5 (every
//! hard criterion met; the LLM never sees min_rows, columns, dates or null rates, SCAM-1), fit ≥
//! min_fit, novelty ≥ min_novelty, and no injection or exfil flag.

use crate::llm::LlmOut;
use crate::schema::{Score, Verdict, GUARD_SCORE};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Gates {
    pub fit_rule: u8,
    /// None = no buyer signature: novelty 3 and the min_novelty gate is skipped
    pub novelty: Option<u8>,
    pub injection_regex: bool,
    pub exfil_regex: bool,
    pub min_fit: u8,
    pub min_novelty: u8,
}

pub fn compose(g: &Gates, llm: &LlmOut) -> Score {
    if g.injection_regex || llm.injection_seen || g.exfil_regex || llm.criterion_exfil {
        return GUARD_SCORE;
    }
    let fit = llm.fit_llm.min(g.fit_rule).clamp(1, 5);
    let novelty = g.novelty.unwrap_or(3).clamp(1, 5);
    let buy = llm.verdict == Verdict::Buy && g.fit_rule == 5 && fit >= g.min_fit && g.novelty.is_none_or(|n| n >= g.min_novelty);
    Score { verdict: if buy { Verdict::Buy } else { Verdict::Pass }, fit, novelty }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::{state_index, Mode};

    const LLM_BUY: LlmOut = LlmOut { fit_llm: 5, verdict: Verdict::Buy, injection_seen: false, criterion_exfil: false };
    const OPEN: Gates = Gates { fit_rule: 5, novelty: Some(5), injection_regex: false, exfil_regex: false, min_fit: 4, min_novelty: 3 };

    #[test]
    fn llm_cannot_buy_without_structural_gates() {
        assert_eq!(compose(&OPEN, &LLM_BUY).verdict, Verdict::Buy);
        let broken: [(&str, Gates, LlmOut); 6] = [
            ("fit_rule < min_fit", Gates { fit_rule: 3, ..OPEN }, LLM_BUY),
            ("novelty < min_novelty", Gates { novelty: Some(2), ..OPEN }, LLM_BUY),
            ("injection_regex", Gates { injection_regex: true, ..OPEN }, LLM_BUY),
            ("exfil_regex", Gates { exfil_regex: true, ..OPEN }, LLM_BUY),
            ("injection_seen", OPEN, LlmOut { injection_seen: true, ..LLM_BUY }),
            ("criterion_exfil", OPEN, LlmOut { criterion_exfil: true, ..LLM_BUY }),
        ];
        for (name, g, l) in broken {
            assert_eq!(compose(&g, &l).verdict, Verdict::Pass, "{name}");
        }
    }

    /// SCAM-1: an unmet hard criterion (fit_rule 4) at the default min_fit 4 is PASS even if the
    /// LLM, which never sees min_rows or required_columns, votes BUY.
    #[test]
    fn unmet_hard_criterion_is_pass_at_default_min_fit() {
        let s = compose(&Gates { fit_rule: 4, min_fit: 4, ..OPEN }, &LLM_BUY);
        assert_eq!((s.verdict, s.fit), (Verdict::Pass, 4));
        let s = compose(&Gates { fit_rule: 4, min_fit: 1, ..OPEN }, &LLM_BUY);
        assert_eq!(s.verdict, Verdict::Pass);
    }

    #[test]
    fn guard_returns_pass_1_1() {
        for g in [Gates { injection_regex: true, ..OPEN }, Gates { exfil_regex: true, ..OPEN }] {
            assert_eq!(compose(&g, &LLM_BUY), GUARD_SCORE);
        }
        assert_eq!(compose(&OPEN, &LlmOut { injection_seen: true, ..LLM_BUY }), GUARD_SCORE);
        assert_eq!(compose(&OPEN, &LlmOut { criterion_exfil: true, ..LLM_BUY }), GUARD_SCORE);
    }

    #[test]
    fn no_signature_novelty_3_gate_skipped() {
        let g = Gates { novelty: None, min_novelty: 5, ..OPEN };
        let s = compose(&g, &LLM_BUY);
        assert_eq!((s.verdict, s.fit, s.novelty), (Verdict::Buy, 5, 3));
    }

    #[test]
    fn fit_is_min_of_llm_and_rule() {
        let s = compose(&Gates { fit_rule: 2, ..OPEN }, &LlmOut { fit_llm: 4, ..LLM_BUY });
        assert_eq!(s.fit, 2);
        let s = compose(&Gates { fit_rule: 5, ..OPEN }, &LlmOut { fit_llm: 3, ..LLM_BUY });
        assert_eq!((s.fit, s.verdict), (3, Verdict::Pass));
    }

    #[test]
    fn exhaustive_compose_in_range() {
        let mut n = 0u32;
        for fit_rule in 1..=5 {
            for fit_llm in 1..=5 {
                for novelty in [None, Some(1), Some(2), Some(3), Some(4), Some(5)] {
                    for verdict in [Verdict::Pass, Verdict::Buy] {
                        for flags in 0..16u8 {
                            for min_fit in 1..=5 {
                                for min_novelty in 1..=5 {
                                    let g = Gates { fit_rule, novelty, injection_regex: flags & 1 != 0, exfil_regex: flags & 2 != 0, min_fit, min_novelty };
                                    let l = LlmOut { fit_llm, verdict, injection_seen: flags & 4 != 0, criterion_exfil: flags & 8 != 0 };
                                    let s = compose(&g, &l);
                                    let idx = state_index(Mode::Scored, &s).unwrap();
                                    assert!(idx <= 49);
                                    let gates_pass = flags == 0
                                        && verdict == Verdict::Buy
                                        && fit_rule == 5
                                        && fit_llm.min(fit_rule) >= min_fit
                                        && novelty.is_none_or(|v| v >= min_novelty);
                                    assert_eq!(s.verdict == Verdict::Buy, gates_pass);
                                    n += 1;
                                }
                            }
                        }
                    }
                }
            }
        }
        assert_eq!(n, 120_000);
    }
}
