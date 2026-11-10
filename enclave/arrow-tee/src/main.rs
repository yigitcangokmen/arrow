#![forbid(unsafe_code)]
#![cfg_attr(not(test), deny(
    clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::indexing_slicing,
    clippy::arithmetic_side_effects, clippy::string_slice, clippy::unreachable,
    clippy::todo, clippy::unimplemented, clippy::print_stderr, clippy::print_stdout,
    clippy::dbg_macro, clippy::exit
))]
//! OutLayer WASI P2 program: derive / eval / release. Never writes to stderr; every error is
//! `{"v":1,"ok":false}` with exit code 0 (DEC I-01).

mod consts;
mod flow;
mod guard;
mod http;
mod io;
mod keys;

fn main() {
    // First statement: a panic must print nothing (wasm32 has no unwinding to catch it).
    std::panic::set_hook(Box::new(|_| {}));
    let start = std::time::Instant::now();
    let out = match io::read_stdin_capped(consts::MAX_STDIN) {
        Ok(input) => flow::run(&input, &flow::RealEnv::new(start), &http::RealNet),
        Err(_) => arrow_core::schema::ERR_JSON.to_vec(),
    };
    io::write_out(&out);
}
