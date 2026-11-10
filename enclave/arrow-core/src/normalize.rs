//! Key normalization shared byte for byte with the TS SDK (DEC I-17, fixtures/README.md):
//! trim → delete Default_Ignorable code points → NFKC → lowercase → delete them again → delete a
//! U+0307 right after `i`
//! → collapse whitespace runs to one space → trim. "Whitespace" is exactly JS `\s` (which is also
//! what `String.prototype.trim` strips), defined by hand: Rust's `char::is_whitespace` differs (it
//! includes U+0085 and excludes U+FEFF).

use unicode_normalization::UnicodeNormalization;

pub fn is_js_ws(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'..='\u{200A}'
            | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}'
    )
}

/// Default_Ignorable_Code_Point (Unicode DerivedCoreProperties), written out so Rust and TS agree
/// without either side's Unicode tables. Invisible, so a key with one of them must stay the same
/// key (X12-U1: a ZWSP prefix made every resold key look new to the buyer's list).
pub fn is_default_ignorable(c: char) -> bool {
    matches!(
        c,
        '\u{AD}' | '\u{34F}' | '\u{61C}' | '\u{115F}'..='\u{1160}' | '\u{17B4}'..='\u{17B5}' | '\u{180B}'..='\u{180F}'
            | '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{206F}' | '\u{3164}'
            | '\u{FE00}'..='\u{FE0F}' | '\u{FEFF}' | '\u{FFA0}' | '\u{FFF0}'..='\u{FFF8}' | '\u{1BCA0}'..='\u{1BCA3}'
            | '\u{1D173}'..='\u{1D17A}' | '\u{E0000}'..='\u{E0FFF}'
    )
}

pub fn normalize_key(s: &str) -> String {
    let mut unlimited = usize::MAX;
    normalize_key_within(s, &mut unlimited).unwrap_or_default()
}

/// normalize_key with a work budget shared by a whole key column: the NFKC output may use at most
/// `*budget` bytes, counted while it is produced, so one giant cell cannot expand past it either.
/// None once the budget is gone (ENC-LEAK-4).
pub fn normalize_key_within(s: &str, budget: &mut usize) -> Option<String> {
    let mut nfkc = String::new();
    // Ignorables go before NFKC: one between a letter and its combining mark blocks composition (R2-3).
    for c in s.trim_matches(is_js_ws).chars().filter(|c| !is_default_ignorable(*c)).nfkc() {
        *budget = budget.checked_sub(c.len_utf8())?;
        nfkc.push(c);
    }
    let lower = nfkc.to_lowercase();
    let mut out = String::with_capacity(lower.len());
    let mut in_ws = false;
    // The previous character after the Default_Ignorable deletion: JS .replace(/i\u0307/g, "i").
    let mut prev = '\0';
    for c in lower.chars().filter(|c| !is_default_ignorable(*c)) {
        let dot_after_i = c == '\u{307}' && prev == 'i';
        prev = c;
        if dot_after_i {
            continue;
        }
        if is_js_ws(c) {
            if !in_ws {
                out.push(' ');
            }
            in_ws = true;
        } else {
            out.push(c);
            in_ws = false;
        }
    }
    Some(out.trim_matches(' ').to_owned())
}

/// Format characters the G5 scan deletes (DEC I-19): every Default_Ignorable code point, so bidi
/// marks, variation selectors, fillers and tag characters inside a keyword do not hide it (X12-U5).
pub fn is_scan_format(c: char) -> bool {
    is_default_ignorable(c)
}

/// NFKC, then the scan's format characters removed. Case is kept (base64 needs it).
pub fn scan_fold(s: &str) -> String {
    s.nfkc().filter(|c| !is_scan_format(*c)).collect()
}

/// G5 scan normalization only (no TS twin): NFKC → delete format characters → lowercase → delete
/// U+0307 (Turkish `İ` lowercases to `i` + U+0307) → collapse whitespace runs. A run that contains
/// a line break becomes `\n`, so `(?m)^` patterns still see line starts; any other run becomes ' '.
pub fn scan_norm(s: &str) -> String {
    let lower = scan_fold(s).to_lowercase();
    let mut out = String::with_capacity(lower.len());
    let mut run: Option<char> = None;
    for c in lower.chars().filter(|c| *c != '\u{307}') {
        if c.is_whitespace() || is_js_ws(c) {
            let nl = c == '\n' || c == '\r' || c == '\u{2028}' || c == '\u{2029}' || c == '\u{85}';
            run = Some(if nl || run == Some('\n') { '\n' } else { ' ' });
        } else {
            if let Some(r) = run.take() {
                out.push(r);
            }
            out.push(c);
        }
    }
    if let Some(r) = run {
        out.push(r);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_norm_folds_and_collapses() {
        assert_eq!(scan_norm("ＩＧＮＯＲＥ\u{200B}  me"), "ignore me");
        assert_eq!(scan_norm("ÖNCEKİ TALİMATLARI"), "önceki talimatlari");
        assert_eq!(scan_norm("a \r\n  SYSTEM: x"), "a\nsystem: x");
        assert_eq!(scan_norm("so\u{AD}ft"), "soft");
        assert_eq!(scan_norm("𝐢𝐠𝐧𝐨𝐫𝐞"), "ignore");
    }

    #[test]
    fn normalize_js_whitespace_set() {
        assert_eq!(normalize_key("\u{FEFF} a \t\u{3000} b \u{A0}"), "a b");
        // U+0085 is not JS whitespace: kept, not trimmed, not collapsed
        assert_eq!(normalize_key("\u{85}x\u{85}"), "\u{85}x\u{85}");
        assert!(!is_js_ws('\u{85}'));
        assert!(is_js_ws('\u{FEFF}') && is_js_ws('\u{2007}') && is_js_ws('\u{202F}'));
    }

    #[test]
    fn normalize_turkish_dotted_i() {
        assert_eq!(normalize_key("İstanbul"), "istanbul");
        assert_eq!(normalize_key("İSTANBUL"), normalize_key("istanbul"));
        assert_eq!(normalize_key("ISTANBUL"), "istanbul");
        assert_eq!(normalize_key("ıi"), "ıi");
        // only the one U+0307 right after an `i` goes, as in JS .replace(/i\u0307/g, "i")
        assert_eq!(normalize_key("i\u{307}\u{307}"), "i\u{307}");
        assert_eq!(normalize_key("e\u{307}"), "\u{117}");
    }

    /// X12-U1: invisible characters do not make a known key look new.
    #[test]
    fn normalize_drops_default_ignorables() {
        for k in ["\u{200B}ACME\u{2060}", "A\u{FE0F}CME", "AC\u{AD}ME", "\u{E0041}acme\u{E007F}", "\u{200E}acme\u{202E}", "\u{200B} acme \u{180E}"] {
            assert_eq!(normalize_key(k), "acme", "{k:?}");
        }
        assert_eq!(normalize_key("a\u{200B}b"), "ab");
        assert_eq!(normalize_key("\u{3164}\u{FFA0}"), "");
    }

    /// R2-3: an invisible character between a letter and its combining mark blocked composition, so
    /// "Jose\u{200B}\u{301}" stayed decomposed and hashed apart from "José".
    #[test]
    fn ignorable_between_letter_and_mark_still_composes() {
        assert_eq!(normalize_key("Jose\u{200B}\u{301}-001"), normalize_key("José-001"));
        assert_eq!(normalize_key("Mu\u{2060}\u{308}ller"), "müller");
        assert_eq!(normalize_key("S\u{FE0F}\u{327}i\u{34F}\u{307}"), normalize_key("Şi"));
    }

    #[test]
    fn normalize_fullwidth_nfkc() {
        assert_eq!(normalize_key("ＡＢＣ１２３"), "abc123");
        assert_eq!(normalize_key("e\u{301}cole"), "\u{e9}cole");
        assert_eq!(normalize_key("ﬁle"), "file");
    }

    #[test]
    fn normalize_greek_final_sigma() {
        assert_eq!(normalize_key("ΟΔΟΣ"), "οδος");
    }
}
