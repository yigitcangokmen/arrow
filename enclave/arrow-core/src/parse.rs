//! CSV (RFC 4180, header row, UTF-8) and JSONL, visited row by row so the whole dataset is never
//! held in memory (WS-3 §0.5). Every parser error is dropped to a data-free `ArrowErr`.

use std::ops::ControlFlow;

use serde_json::{Map, Value};

use crate::consts::{MAX_BLOB, MAX_COLS, MAX_ROWS};
use crate::err::ArrowErr;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Format {
    Csv,
    Jsonl,
}

const BOM: &[u8] = b"\xEF\xBB\xBF";

/// Strips a UTF-8 BOM; the first non-whitespace byte `{` means JSONL, anything else CSV.
/// The whole input must be UTF-8.
pub fn detect(plain: &[u8]) -> Result<(Format, &[u8]), ArrowErr> {
    if plain.len() > MAX_BLOB {
        return Err(ArrowErr::BlobTooLarge);
    }
    let body = plain.strip_prefix(BOM).unwrap_or(plain);
    std::str::from_utf8(body).map_err(|_| ArrowErr::Format)?;
    let first = body.iter().find(|b| !b.is_ascii_whitespace());
    let f = if first == Some(&b'{') { Format::Jsonl } else { Format::Csv };
    Ok((f, body))
}

fn check_cols(cols: Vec<String>) -> Result<Vec<String>, ArrowErr> {
    if cols.is_empty() {
        return Err(ArrowErr::Empty);
    }
    if cols.len() > MAX_COLS {
        return Err(ArrowErr::Limits);
    }
    Ok(cols)
}

fn csv_reader(body: &[u8]) -> csv::Reader<&[u8]> {
    csv::ReaderBuilder::new().has_headers(true).flexible(false).from_reader(body)
}

fn jsonl_lines(body: &[u8]) -> impl Iterator<Item = &[u8]> {
    body.split(|&b| b == b'\n')
        .map(|l| l.strip_suffix(b"\r").unwrap_or(l))
        .filter(|l| !l.iter().all(u8::is_ascii_whitespace))
}

fn jsonl_object(line: &[u8]) -> Result<Map<String, Value>, ArrowErr> {
    serde_json::from_slice::<Map<String, Value>>(line).map_err(|_| ArrowErr::Format)
}

/// CSV: the first record. JSONL: the sorted keys of the first object.
pub fn header(body: &[u8], f: Format) -> Result<Vec<String>, ArrowErr> {
    match f {
        Format::Csv => {
            let mut rdr = csv_reader(body);
            let h = rdr.byte_headers().map_err(|_| ArrowErr::Format)?;
            let cols = h
                .iter()
                .map(|b| std::str::from_utf8(b).map(str::to_owned).map_err(|_| ArrowErr::Format))
                .collect::<Result<Vec<_>, _>>()?;
            check_cols(cols)
        }
        Format::Jsonl => {
            let first = jsonl_lines(body).next().ok_or(ArrowErr::Empty)?;
            let mut cols: Vec<String> = jsonl_object(first)?.keys().cloned().collect();
            cols.sort();
            check_cols(cols)
        }
    }
}

fn jsonl_cell(v: Option<&Value>) -> Option<String> {
    match v {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) => Some(s.clone()),
        Some(other) => Some(other.to_string()),
    }
}

fn bump(n: u32) -> Result<u32, ArrowErr> {
    let n = n.checked_add(1).ok_or(ArrowErr::Limits)?;
    if n > MAX_ROWS {
        return Err(ArrowErr::Limits);
    }
    Ok(n)
}

/// Visits rows in order until the visitor breaks. Returns the number of rows visited.
pub(crate) fn walk<F>(body: &[u8], f: Format, cols: &[String], mut visit: F) -> Result<u32, ArrowErr>
where
    F: FnMut(u32, &[Option<&str>]) -> Result<ControlFlow<()>, ArrowErr>,
{
    let mut n: u32 = 0;
    match f {
        Format::Csv => {
            let mut rdr = csv_reader(body);
            let mut rec = csv::ByteRecord::new();
            loop {
                let more = rdr.read_byte_record(&mut rec).map_err(|_| ArrowErr::Format)?;
                if !more {
                    break;
                }
                let cells = rec
                    .iter()
                    .map(|b| std::str::from_utf8(b).map(Some).map_err(|_| ArrowErr::Format))
                    .collect::<Result<Vec<_>, _>>()?;
                let idx = n;
                n = bump(n)?;
                if visit(idx, &cells)?.is_break() {
                    return Ok(n);
                }
            }
        }
        Format::Jsonl => {
            for line in jsonl_lines(body) {
                let obj = jsonl_object(line)?;
                let owned: Vec<Option<String>> = cols.iter().map(|c| jsonl_cell(obj.get(c))).collect();
                let cells: Vec<Option<&str>> = owned.iter().map(Option::as_deref).collect();
                let idx = n;
                n = bump(n)?;
                if visit(idx, &cells)?.is_break() {
                    return Ok(n);
                }
            }
        }
    }
    if n == 0 {
        return Err(ArrowErr::Empty);
    }
    Ok(n)
}

/// Visits every data row (0-based index, cells in `cols` order). Err(Empty) if there is none.
pub fn for_each_row<F>(body: &[u8], f: Format, cols: &[String], mut visit: F) -> Result<u32, ArrowErr>
where
    F: FnMut(u32, &[Option<&str>]) -> Result<(), ArrowErr>,
{
    walk(body, f, cols, |i, cells| visit(i, cells).map(|()| ControlFlow::Continue(())))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rows(input: &[u8]) -> Result<(Vec<String>, Vec<Vec<Option<String>>>), ArrowErr> {
        let (f, body) = detect(input)?;
        let cols = header(body, f)?;
        let mut out = Vec::new();
        for_each_row(body, f, &cols, |_, c| {
            out.push(c.iter().map(|x| x.map(str::to_owned)).collect());
            Ok(())
        })?;
        Ok((cols, out))
    }

    fn s(x: &str) -> Option<String> {
        Some(x.to_owned())
    }

    #[test]
    fn csv_basic() {
        let (cols, r) = rows(b"a,b\n1,2\n3,4\n").unwrap();
        assert_eq!(cols, vec!["a", "b"]);
        assert_eq!(r, vec![vec![s("1"), s("2")], vec![s("3"), s("4")]]);
    }

    #[test]
    fn csv_quoted_newline_rfc4180() {
        let (_, r) = rows(b"a,b\r\n\"x\ny\",\"he said \"\"hi\"\"\"\r\n").unwrap();
        assert_eq!(r, vec![vec![s("x\ny"), s("he said \"hi\"")]]);
    }

    #[test]
    fn csv_ragged_rejected() {
        assert_eq!(rows(b"a,b\n1,2\n3\n").unwrap_err(), ArrowErr::Format);
        assert_eq!(rows(b"a,b\n1,2,3\n").unwrap_err(), ArrowErr::Format);
    }

    #[test]
    fn csv_invalid_utf8_rejected() {
        assert_eq!(rows(b"a,b\n1,\xff\n").unwrap_err(), ArrowErr::Format);
    }

    #[test]
    fn bom_stripped() {
        let (f, body) = detect(b"\xEF\xBB\xBFa,b\n1,2\n").unwrap();
        assert_eq!(f, Format::Csv);
        assert_eq!(header(body, f).unwrap(), vec!["a", "b"]);
        let (f, _) = detect(b"\xEF\xBB\xBF  {\"a\":1}\n").unwrap();
        assert_eq!(f, Format::Jsonl);
    }

    #[test]
    fn jsonl_basic() {
        let (cols, r) = rows(b"{\"b\":\"x\",\"a\":1}\n\n{\"a\":2,\"b\":\"y\"}\r\n").unwrap();
        assert_eq!(cols, vec!["a", "b"]);
        assert_eq!(r, vec![vec![s("1"), s("x")], vec![s("2"), s("y")]]);
    }

    #[test]
    fn jsonl_missing_key_is_null() {
        let (_, r) = rows(b"{\"a\":1,\"b\":2}\n{\"a\":3}\n{\"a\":null,\"b\":true,\"c\":9}\n").unwrap();
        assert_eq!(r, vec![vec![s("1"), s("2")], vec![s("3"), None], vec![None, s("true")]]);
    }

    #[test]
    fn jsonl_nested_value_compact() {
        let (_, r) = rows(b"{\"a\": {\"x\": [1, 2]}, \"b\": 123456789012345678901234567890}\n").unwrap();
        assert_eq!(r[0][0], s("{\"x\":[1,2]}"));
        // Out-of-range integers stay a serde_json Number (f64) and become text; no panic.
        assert!(!r[0][1].as_deref().unwrap().is_empty());
    }

    #[test]
    fn jsonl_non_object_rejected() {
        assert_eq!(rows(b"{\"a\":1}\n[1,2]\n").unwrap_err(), ArrowErr::Format);
        assert_eq!(rows(b"{\"a\":1}\n{bad\n").unwrap_err(), ArrowErr::Format);
    }

    #[test]
    fn limits_65_columns_rejected() {
        let h: Vec<String> = (0..65).map(|i| format!("c{i}")).collect();
        let csv = format!("{}\n{}\n", h.join(","), vec!["1"; 65].join(","));
        assert_eq!(rows(csv.as_bytes()).unwrap_err(), ArrowErr::Limits);
        let h64: Vec<String> = (0..64).map(|i| format!("c{i}")).collect();
        let csv = format!("{}\n{}\n", h64.join(","), vec!["1"; 64].join(","));
        assert_eq!(rows(csv.as_bytes()).unwrap().0.len(), 64);
    }

    #[test]
    fn limits_200001_rows_rejected() {
        let mut csv = String::from("a\n");
        for _ in 0..200_001 {
            csv.push_str("1\n");
        }
        assert_eq!(rows(csv.as_bytes()).unwrap_err(), ArrowErr::Limits);
        let ok = &csv.as_bytes()[..csv.len() - 2];
        assert_eq!(rows(ok).unwrap().1.len(), 200_000);
    }

    #[test]
    fn limits_blob_too_large() {
        let big = vec![b'a'; MAX_BLOB + 1];
        assert_eq!(detect(&big).unwrap_err(), ArrowErr::BlobTooLarge);
    }

    #[test]
    fn header_only_is_empty_err() {
        assert_eq!(rows(b"a,b\n").unwrap_err(), ArrowErr::Empty);
        assert_eq!(rows(b"").unwrap_err(), ArrowErr::Empty);
        assert_eq!(rows(b"\n\n").unwrap_err(), ArrowErr::Empty);
        assert_eq!(rows(b"{}\n").unwrap_err(), ArrowErr::Empty);
    }
}
