//! The only place that touches stdin and stdout. Nothing is ever written to stderr.

use std::io::{Read, Write};

use arrow_core::ArrowErr;

/// Reads at most `max` bytes; more than that is `Err(Input)`.
pub fn read_stdin_capped(max: usize) -> Result<Vec<u8>, ArrowErr> {
    let mut buf = Vec::new();
    let limit = u64::try_from(max).map_err(|_| ArrowErr::Internal)?.saturating_add(1);
    std::io::stdin().lock().take(limit).read_to_end(&mut buf).map_err(|_| ArrowErr::Input)?;
    if buf.len() > max {
        return Err(ArrowErr::Input);
    }
    Ok(buf)
}

/// write_all + flush; errors are ignored (there is nowhere to report them).
pub fn write_out(out: &[u8]) {
    let mut s = std::io::stdout().lock();
    let _ = s.write_all(out);
    let _ = s.flush();
}
