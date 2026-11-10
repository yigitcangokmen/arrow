#![forbid(unsafe_code)]
#![cfg_attr(not(test), deny(
    clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::indexing_slicing,
    clippy::arithmetic_side_effects, clippy::string_slice, clippy::unreachable,
    clippy::todo, clippy::unimplemented, clippy::print_stderr, clippy::print_stdout,
    clippy::dbg_macro, clippy::exit
))]
//! Pure, panic-free evaluation logic shared by `arrow-tee`. Errors are a fixed enum and carry no data.

pub mod consts;
pub mod err;
pub mod llm;
pub mod parse;
pub mod prompt;
pub mod sample;
pub mod schema;
pub mod stats;

pub use err::ArrowErr;
