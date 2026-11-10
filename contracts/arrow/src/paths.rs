#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PaymentPath {
    Notify,
    Escrow,
}
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ResultPath {
    Chain,
    SignedHttps,
}

/// K0 (WS1-T11) changes ONLY this line. Reproducible builds pass no env, so this committed value is what mainnet runs.
pub const DEFAULT_PAYMENT_PATH: PaymentPath = PaymentPath::Notify;
/// SignedHttps exists only if H-24 (single hard stop) picks it. See WS2-T10 appendix.
pub const RESULT_PATH: ResultPath = ResultPath::Chain;

const fn bytes_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut i = 0;
    while i < a.len() {
        if a[i] != b[i] {
            return false;
        }
        i += 1;
    }
    true
}

/// Sandbox/testnet variants may override with ARROW_PAYMENT_PATH=notify|escrow at build time.
pub const PAYMENT_PATH: PaymentPath = match option_env!("ARROW_PAYMENT_PATH") {
    None => DEFAULT_PAYMENT_PATH,
    Some(s) if bytes_eq(s.as_bytes(), b"notify") => PaymentPath::Notify,
    Some(s) if bytes_eq(s.as_bytes(), b"escrow") => PaymentPath::Escrow,
    Some(_) => panic!("ARROW_PAYMENT_PATH must be notify or escrow"),
};

#[cfg(test)]
thread_local! {
    /// Unit tests set this to cover both paths in one build; production code never sees it.
    pub static TEST_PAYMENT_PATH: std::cell::Cell<Option<PaymentPath>> = const { std::cell::Cell::new(None) };
}

/// The payment path this build runs ([`PAYMENT_PATH`]); unit tests may override it per thread.
pub fn payment_path() -> PaymentPath {
    #[cfg(test)]
    if let Some(p) = TEST_PAYMENT_PATH.with(|c| c.get()) {
        return p;
    }
    PAYMENT_PATH
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payment_path_default_is_committed_value() {
        if option_env!("ARROW_PAYMENT_PATH").is_none() {
            assert_eq!(PAYMENT_PATH, DEFAULT_PAYMENT_PATH);
        }
        assert_eq!(RESULT_PATH, ResultPath::Chain);
    }
}
