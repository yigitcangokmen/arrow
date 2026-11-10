//! Fixed endpoint, model, allowlists and time limits (DEC I-02, I-03, I-05, I-10, I-11).
//! Every value here is part of the wasm hash: changing one after the freeze needs the human's OK.

use std::time::Duration;

use arrow_core::llm::Reasoning;

/// Model, the `model` value the response must carry, and how reasoning is switched off.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LlmProfile {
    pub model: &'static str,
    pub expected_response_model: &'static str,
    pub reasoning: Reasoning,
}

/// Default (DEC I-05): Qwen with `chat_template_kwargs.enable_thinking=false`.
pub const QWEN: LlmProfile = LlmProfile {
    model: "Qwen/Qwen3.8-27B",
    expected_response_model: "Qwen/Qwen3.8-27B",
    reasoning: Reasoning::QwenNoThinking,
};
/// S1-a fallback 1 (DEC G-04): same model, `/no_think` soft switch instead of the kwarg.
#[allow(dead_code)]
pub const QWEN_SOFT: LlmProfile = LlmProfile { reasoning: Reasoning::QwenSoftSwitch, ..QWEN };
/// S1-a fallback 2 (DEC G-04): GLM with `reasoning_effort:"low"`.
#[allow(dead_code)]
pub const GLM: LlmProfile = LlmProfile {
    model: "z-ai/glm-5.3-flash",
    expected_response_model: "z-ai/glm-5.3-flash",
    reasoning: Reasoning::GlmLow,
};
/// The S1-a gate picks one of QWEN / QWEN_SOFT / GLM here (and sets the response model it
/// observed). S1-a is still pending (H-01a), so this is the card default.
pub const LLM: LlmProfile = QWEN;

pub const T_PAD: Duration = Duration::from_secs(45);
/// 80 / 50 if the S1-b clock skew were > 10 s; S1-b measured max 5.6 s (spikes/GATES.md).
pub const EVAL_DEADLINE: Duration = Duration::from_secs(90);
pub const RELEASE_DEADLINE: Duration = Duration::from_secs(60);
pub const ALLOW_MAINNET: [&str; 2] = ["arrow-market.near", "arrow-market-v2.near"];
pub const ALLOW_TESTNET: [&str; 2] = ["arrow.arrowhq.testnet", "arrow-v2.arrowhq.testnet"];
pub const MAX_STDIN: usize = 32 * 1024;
pub const MASTER_ENV: &str = "PROTECTED_MASTER";
pub const NEARAI_KEY_ENV: &str = "NEARAI_API_KEY";
pub const HKDF_INFO: &[u8] = b"arrow/program/v1";
/// `sealed_k` plaintext: K (32) ‖ blob_sha256 (32) (DEC J-04).
pub const SEALED_K_LEN: usize = 64;
