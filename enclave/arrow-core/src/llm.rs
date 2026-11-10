//! The fixed NEAR AI request body and the strict response parser (DEC I-05, guide invariant 4).

use serde::Deserialize;

use crate::consts::{LLM_MAX_TOKENS, MAX_LLM_RESPONSE};
use crate::err::ArrowErr;
use crate::schema::Verdict;

/// How reasoning is switched off; the S1-a gate picks one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reasoning {
    /// `"chat_template_kwargs":{"enable_thinking":false}`
    QwenNoThinking,
    /// no kwargs; the user message ends with `\n/no_think`
    QwenSoftSwitch,
    /// `"reasoning_effort":"low"` (GLM fallback model)
    GlmLow,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LlmOut {
    pub fit_llm: u8,
    pub verdict: Verdict,
    pub injection_seen: bool,
    pub criterion_exfil: bool,
}

const RESPONSE_FORMAT: &str = r#"{"type":"json_schema","json_schema":{"name":"arrow_verdict","strict":true,"schema":{"type":"object","additionalProperties":false,"required":["fit_llm","verdict","injection_seen","criterion_exfil"],"properties":{"fit_llm":{"type":"integer","minimum":1,"maximum":5},"verdict":{"type":"string","enum":["BUY","PASS"]},"injection_seen":{"type":"boolean"},"criterion_exfil":{"type":"boolean"}}}}}"#;

/// Request body with a fixed field order. Written by hand (not via a serde map) so the bytes do
/// not depend on serde_json feature flags elsewhere in the build.
pub fn request_body(model: &str, reasoning: Reasoning, system: &str, user: &str) -> Result<Vec<u8>, ArrowErr> {
    let enc = |s: &str| serde_json::to_string(s).map_err(|_| ArrowErr::Internal);
    let extra = match reasoning {
        Reasoning::QwenNoThinking => r#","chat_template_kwargs":{"enable_thinking":false}"#,
        Reasoning::QwenSoftSwitch => "",
        Reasoning::GlmLow => r#","reasoning_effort":"low""#,
    };
    Ok(format!(
        r#"{{"model":{},"messages":[{{"role":"system","content":{}}},{{"role":"user","content":{}}}],"temperature":0.0,"max_tokens":{},"response_format":{}{}}}"#,
        enc(model)?,
        enc(system)?,
        enc(user)?,
        LLM_MAX_TOKENS,
        RESPONSE_FORMAT,
        extra
    )
    .into_bytes())
}

#[derive(Deserialize)]
struct Resp {
    model: String,
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    finish_reason: Option<String>,
    message: Msg,
}

#[derive(Deserialize)]
struct Msg {
    content: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LlmJson {
    fit_llm: u8,
    verdict: String,
    injection_seen: bool,
    criterion_exfil: bool,
}

/// Every deviation from the schema is `Err(LlmSchema)`. The caller checks HTTP 200 first.
pub fn parse_response(body: &[u8], expected_model: &str) -> Result<LlmOut, ArrowErr> {
    if body.len() > MAX_LLM_RESPONSE {
        return Err(ArrowErr::LlmSchema);
    }
    let r: Resp = serde_json::from_slice(body).map_err(|_| ArrowErr::LlmSchema)?;
    if r.model != expected_model {
        return Err(ArrowErr::LlmSchema);
    }
    let [c] = r.choices.as_slice() else {
        return Err(ArrowErr::LlmSchema);
    };
    if c.finish_reason.as_deref() != Some("stop") {
        return Err(ArrowErr::LlmSchema);
    }
    let content = c.message.content.as_deref().ok_or(ArrowErr::LlmSchema)?.trim();
    let j: LlmJson = serde_json::from_str(content).map_err(|_| ArrowErr::LlmSchema)?;
    if !(1..=5).contains(&j.fit_llm) {
        return Err(ArrowErr::LlmSchema);
    }
    let verdict = match j.verdict.as_str() {
        "BUY" => Verdict::Buy,
        "PASS" => Verdict::Pass,
        _ => return Err(ArrowErr::LlmSchema),
    };
    Ok(LlmOut { fit_llm: j.fit_llm, verdict, injection_seen: j.injection_seen, criterion_exfil: j.criterion_exfil })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    const M: &str = "Qwen/Qwen3.8-27B";

    fn resp(content: &str) -> Value {
        json!({"id":"x","model":M,"choices":[{"index":0,"finish_reason":"stop","message":{"role":"assistant","content":content,"reasoning_content":null}}],"usage":{"completion_tokens":20}})
    }

    fn parse(v: &Value) -> Result<LlmOut, ArrowErr> {
        parse_response(v.to_string().as_bytes(), M)
    }

    #[test]
    fn request_has_fixed_params() {
        for (r, has_kwargs, has_effort) in [
            (Reasoning::QwenNoThinking, true, false),
            (Reasoning::QwenSoftSwitch, false, false),
            (Reasoning::GlmLow, false, true),
        ] {
            let b = request_body(M, r, "sys", "usr").unwrap();
            let s = std::str::from_utf8(&b).unwrap();
            assert!(s.contains(r#""temperature":0.0"#));
            assert!(s.contains(r#""max_tokens":64"#));
            assert!(s.contains(r#""type":"json_schema""#));
            assert!(s.contains(r#""strict":true"#));
            assert_eq!(s.contains(r#""chat_template_kwargs":{"enable_thinking":false}"#), has_kwargs);
            assert_eq!(s.contains(r#""reasoning_effort":"low""#), has_effort);
            let v: Value = serde_json::from_slice(&b).unwrap();
            assert_eq!(v["model"], M);
            assert_eq!(v["messages"][0]["content"], "sys");
            assert_eq!(v["messages"][1]["content"], "usr");
            let req = v["response_format"]["json_schema"]["schema"]["required"].as_array().unwrap().len();
            assert_eq!(req, 4);
        }
    }

    #[test]
    fn parse_response_ok() {
        let v = resp(r#" {"fit_llm":4,"verdict":"BUY","injection_seen":false,"criterion_exfil":true} "#);
        assert_eq!(
            parse(&v).unwrap(),
            LlmOut { fit_llm: 4, verdict: Verdict::Buy, injection_seen: false, criterion_exfil: true }
        );
        let v = resp(r#"{"verdict":"PASS","fit_llm":1,"criterion_exfil":false,"injection_seen":true}"#);
        assert_eq!(parse(&v).unwrap().verdict, Verdict::Pass);
    }

    #[test]
    fn parse_response_rejects() {
        let ok = r#"{"fit_llm":3,"verdict":"PASS","injection_seen":false,"criterion_exfil":false}"#;
        let bad_contents = [
            r#"{"fit_llm":0,"verdict":"PASS","injection_seen":false,"criterion_exfil":false}"#,
            r#"{"fit_llm":6,"verdict":"PASS","injection_seen":false,"criterion_exfil":false}"#,
            r#"{"fit_llm":3,"verdict":"MAYBE","injection_seen":false,"criterion_exfil":false}"#,
            r#"{"fit_llm":3,"verdict":"PASS","injection_seen":false,"criterion_exfil":false,"note":"x"}"#,
            r#"{"fit_llm":3,"verdict":"PASS","injection_seen":false}"#,
            "```json\n{\"fit_llm\":3,\"verdict\":\"PASS\",\"injection_seen\":false,\"criterion_exfil\":false}\n```",
            "BUY",
        ];
        for c in bad_contents {
            assert_eq!(parse(&resp(c)), Err(ArrowErr::LlmSchema), "{c}");
        }
        let mut v = resp(ok);
        v["choices"][0]["finish_reason"] = json!("length");
        assert_eq!(parse(&v), Err(ArrowErr::LlmSchema));
        let mut v = resp(ok);
        v["model"] = json!("z-ai/glm-5.3-flash");
        assert_eq!(parse(&v), Err(ArrowErr::LlmSchema));
        let mut v = resp(ok);
        let c = v["choices"][0].clone();
        v["choices"] = json!([c.clone(), c]);
        assert_eq!(parse(&v), Err(ArrowErr::LlmSchema));
        let mut v = resp(ok);
        v["padding"] = json!("x".repeat(MAX_LLM_RESPONSE));
        assert_eq!(parse(&v), Err(ArrowErr::LlmSchema));
        assert_eq!(parse_response(b"<html>502</html>", M), Err(ArrowErr::LlmSchema));
        assert!(parse(&resp(ok)).is_ok());
    }
}
