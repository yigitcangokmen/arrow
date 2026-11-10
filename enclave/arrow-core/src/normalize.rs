//! Key normalization shared byte for byte with the TS SDK (DEC I-17, fixtures/README.md):
//! trim → NFKC → lowercase → collapse whitespace runs to one space. "Whitespace" is exactly JS `\s`
//! (which is also what `String.prototype.trim` strips), defined by hand: Rust's
//! `char::is_whitespace` differs (it includes U+0085 and excludes U+FEFF).

use unicode_normalization::UnicodeNormalization;

pub fn is_js_ws(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'..='\u{200A}'
            | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}'
    )
}

pub fn normalize_key(s: &str) -> String {
    let nfkc: String = s.trim_matches(is_js_ws).nfkc().collect();
    let lower = nfkc.to_lowercase();
    let mut out = String::with_capacity(lower.len());
    let mut in_ws = false;
    for c in lower.chars() {
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
    out
}

/// Format characters the G5 scan deletes (DEC I-19): zero-width, word joiner, BOM, soft hyphen,
/// invisible operators, Mongolian vowel separator.
pub fn is_scan_format(c: char) -> bool {
    matches!(c, '\u{200B}'..='\u{200D}' | '\u{2060}'..='\u{2064}' | '\u{FEFF}' | '\u{AD}' | '\u{180E}')
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
        assert_eq!(normalize_key("İstanbul"), "i\u{307}stanbul");
        assert_eq!(normalize_key("ISTANBUL"), "istanbul");
        assert_eq!(normalize_key("ıi"), "ıi");
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
