//! Network access for the enclave: blob GET and the NEAR AI POST (DEC I-05, I-13), written on the
//! wasi 0.13.3 bindings directly. wasi-http-client 0.2.1 writes a body in one
//! blocking_write_and_flush call (wasmtime traps above 4096 bytes) and has no total timeout.
//! Here the body goes out in 4096-byte chunks and one monotonic-clock timer bounds the whole call,
//! even where the host ignores the per-phase timeouts.

use std::time::Duration;

use arrow_core::consts::MAX_BLOB;
use arrow_core::ArrowErr;
use wasi::clocks::monotonic_clock;
use wasi::http::outgoing_handler;
use wasi::http::types::{Fields, Method, OutgoingBody, OutgoingRequest, RequestOptions, Scheme};
use wasi::io::poll::{poll, Pollable};
use wasi::io::streams::StreamError;

use crate::consts::NEARAI_URL;
use crate::flow::Net;

pub struct Limits {
    pub connect: Duration,
    pub first_byte: Duration,
    pub between: Duration,
    /// Wall time for the whole call, from sending the request to the last body byte.
    pub deadline: Duration,
    pub max_body: usize,
}

pub const BLOB: Limits = Limits {
    connect: Duration::from_secs(10),
    first_byte: Duration::from_secs(15),
    between: Duration::from_secs(10),
    deadline: Duration::from_secs(25),
    max_body: MAX_BLOB,
};

pub const CHAT: Limits = Limits {
    connect: Duration::from_secs(10),
    first_byte: Duration::from_secs(35),
    between: Duration::from_secs(10),
    deadline: Duration::from_secs(35),
    max_body: 65_536,
};

const MAX_URL: usize = 200;
const WRITE_CHUNK: usize = 4096;
const READ_CHUNK: u64 = 65_536;
const USER_AGENT: &[u8] = b"arrow-tee/1";

#[derive(Debug, PartialEq, Eq)]
pub struct Url<'a> {
    pub https: bool,
    pub authority: &'a str,
    pub path_q: &'a str,
}

/// https only (the dev build also takes `http://127.0.0.1:<port>`), at most 200 chars, no
/// userinfo, fragment or whitespace; the authority is a plain host[:port]. Path defaults to "/".
pub fn parse_url(u: &str) -> Result<Url<'_>, ArrowErr> {
    if u.len() > MAX_URL || u.contains(['@', '#']) || u.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(ArrowErr::BlobUrl);
    }
    let (https, rest) = match u.strip_prefix("https://") {
        Some(r) => (true, r),
        None if cfg!(feature = "dev-endpoints") && u.starts_with("http://127.0.0.1:") => {
            (false, u.strip_prefix("http://").ok_or(ArrowErr::BlobUrl)?)
        }
        None => return Err(ArrowErr::BlobUrl),
    };
    let (authority, path_q) = match rest.find('/') {
        Some(i) => (rest.get(..i).ok_or(ArrowErr::BlobUrl)?, rest.get(i..).ok_or(ArrowErr::BlobUrl)?),
        None => (rest, "/"),
    };
    if authority.is_empty() || !authority.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-' || b == b':') {
        return Err(ArrowErr::BlobUrl);
    }
    Ok(Url { https, authority, path_q })
}

enum Fail {
    Net,
    TooLarge,
}

fn ns(d: Duration) -> u64 {
    u64::try_from(d.as_nanos()).unwrap_or(u64::MAX)
}

/// true if `p` became ready before the deadline timer fired.
fn wait(p: &Pollable, timer: &Pollable) -> bool {
    poll(&[p, timer]).contains(&0)
}

/// One request; only a 200 response with a body of at most `max_body` bytes is Ok. Redirects are
/// not followed.
fn send(method: &Method, url: &Url, headers: &[(&str, &[u8])], body: Option<&[u8]>, lim: &Limits) -> Result<Vec<u8>, Fail> {
    let fields = Fields::new();
    for (k, v) in headers {
        fields.append(&(*k).to_owned(), &v.to_vec()).map_err(|_| Fail::Net)?;
    }
    let req = OutgoingRequest::new(fields);
    req.set_method(method).map_err(|_| Fail::Net)?;
    let scheme = if url.https { Scheme::Https } else { Scheme::Http };
    req.set_scheme(Some(&scheme)).map_err(|_| Fail::Net)?;
    req.set_authority(Some(url.authority)).map_err(|_| Fail::Net)?;
    req.set_path_with_query(Some(url.path_q)).map_err(|_| Fail::Net)?;

    // A host that does not support a timeout returns Err(()); the request still goes out and the
    // deadline timer below still holds (WS3-T09 fallback).
    let opts = RequestOptions::new();
    let _ = opts.set_connect_timeout(Some(ns(lim.connect)));
    let _ = opts.set_first_byte_timeout(Some(ns(lim.first_byte)));
    let _ = opts.set_between_bytes_timeout(Some(ns(lim.between)));

    // The request is dispatched before its body is written: wasmtime's body pipe is only drained
    // once the request is in flight, so a body over its buffer blocks forever if written first.
    let ob = req.body().map_err(|_| Fail::Net)?;
    let timer = monotonic_clock::subscribe_duration(ns(lim.deadline));
    let fut = outgoing_handler::handle(req, Some(opts)).map_err(|_| Fail::Net)?;
    if let Some(b) = body {
        let w = ob.write().map_err(|_| Fail::Net)?;
        for ch in b.chunks(WRITE_CHUNK) {
            w.blocking_write_and_flush(ch).map_err(|_| Fail::Net)?;
        }
        drop(w);
    }
    OutgoingBody::finish(ob, None).map_err(|_| Fail::Net)?;
    let resp = loop {
        if let Some(r) = fut.get() {
            break r;
        }
        let p = fut.subscribe();
        let ready = wait(&p, &timer);
        drop(p);
        if !ready {
            return Err(Fail::Net);
        }
    };
    let resp = match resp {
        Ok(Ok(r)) => r,
        _ => return Err(Fail::Net),
    };
    drop(fut);
    if resp.status() != 200 {
        return Err(Fail::Net);
    }
    let ib = resp.consume().map_err(|_| Fail::Net)?;
    let s = ib.stream().map_err(|_| Fail::Net)?;
    let mut out = Vec::new();
    let res = loop {
        if timer.ready() {
            break Err(Fail::Net);
        }
        match s.read(READ_CHUNK) {
            Ok(c) if c.is_empty() => {
                let p = s.subscribe();
                let ready = wait(&p, &timer);
                drop(p);
                if !ready {
                    break Err(Fail::Net);
                }
            }
            Ok(c) => {
                if out.len().saturating_add(c.len()) > lim.max_body {
                    break Err(Fail::TooLarge);
                }
                out.extend_from_slice(&c);
            }
            Err(StreamError::Closed) => break Ok(out),
            Err(_) => break Err(Fail::Net),
        }
    };
    // Child resources go before their parents, or wasmtime traps.
    drop(s);
    drop(ib);
    drop(resp);
    res
}

fn chat_url() -> String {
    #[cfg(feature = "dev-endpoints")]
    if let Ok(u) = std::env::var("ARROW_DEV_NEARAI_URL") {
        return u;
    }
    NEARAI_URL.to_owned()
}

pub struct RealNet;

impl Net for RealNet {
    fn get_blob(&self, url: &str) -> Result<Vec<u8>, ArrowErr> {
        let u = parse_url(url)?;
        send(&Method::Get, &u, &[("user-agent", USER_AGENT)], None, &BLOB).map_err(|f| match f {
            Fail::TooLarge => ArrowErr::BlobTooLarge,
            Fail::Net => ArrowErr::BlobFetch,
        })
    }

    fn chat(&self, key: &str, body: &[u8]) -> Result<Vec<u8>, ArrowErr> {
        let url = chat_url();
        let u = parse_url(&url).map_err(|_| ArrowErr::Llm)?;
        let auth = format!("Bearer {key}");
        let headers: [(&str, &[u8]); 3] =
            [("content-type", b"application/json"), ("authorization", auth.as_bytes()), ("user-agent", USER_AGENT)];
        send(&Method::Post, &u, &headers, Some(body), &CHAT).map_err(|_| ArrowErr::Llm)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_url_accepts_https_vercel_blob() {
        let u = parse_url("https://abc123xyz.public.blob.vercel-storage.com/blobs/0a1b.bin").unwrap();
        assert_eq!(u, Url { https: true, authority: "abc123xyz.public.blob.vercel-storage.com", path_q: "/blobs/0a1b.bin" });
        assert_eq!(parse_url("https://host.example").unwrap().path_q, "/");
        assert_eq!(parse_url("https://host.example:8443/a?b=c").unwrap().authority, "host.example:8443");
    }

    #[test]
    fn parse_url_accepts_raw_github() {
        let u = parse_url("https://raw.githubusercontent.com/yigitcangokmen/arrow/main/release/x.bin").unwrap();
        assert_eq!(u.authority, "raw.githubusercontent.com");
        assert_eq!(u.path_q, "/yigitcangokmen/arrow/main/release/x.bin");
    }

    #[test]
    fn parse_url_rejects() {
        let long = format!("https://h.example/{}", "a".repeat(183));
        assert_eq!(long.len(), 201);
        for bad in [
            "ftp://h.example/x",
            "https://u@h.example/x",
            "https://h.example/a b",
            "https://h.example/x#frag",
            "https:///x",
            "https://h_x.example/x",
            "https://h.example\n/x",
            "",
            long.as_str(),
        ] {
            assert_eq!(parse_url(bad), Err(ArrowErr::BlobUrl), "{bad:?}");
        }
        assert!(parse_url(&long[..200]).is_ok());
        // The release build never talks plain http, not even to localhost.
        let local = parse_url("http://127.0.0.1:8787/blob/x");
        if cfg!(feature = "dev-endpoints") {
            assert_eq!(local.unwrap(), Url { https: false, authority: "127.0.0.1:8787", path_q: "/blob/x" });
        } else {
            assert_eq!(local, Err(ArrowErr::BlobUrl));
        }
        assert_eq!(parse_url("http://h.example/x"), Err(ArrowErr::BlobUrl));
        assert_eq!(parse_url("http://127.0.0.2:80/x"), Err(ArrowErr::BlobUrl));
    }

    #[test]
    fn limits_constants_match_dec() {
        assert_eq!((CHAT.connect, CHAT.deadline), (Duration::from_secs(10), Duration::from_secs(35)));
        assert_eq!(BLOB.connect, Duration::from_secs(10));
        assert_eq!(BLOB.max_body, 5_242_880);
        assert_eq!(CHAT.max_body, 65_536);
        assert!(BLOB.deadline < CHAT.deadline);
        assert_eq!(NEARAI_URL, "https://cloud-api.near.ai/v1/chat/completions");
        assert_eq!(parse_url(NEARAI_URL).unwrap().path_q, "/v1/chat/completions");
    }
}
