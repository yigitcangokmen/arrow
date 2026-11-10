//! Network access for the enclave (WS3-T09 fills this in).

use arrow_core::ArrowErr;

use crate::flow::Net;

pub struct RealNet;

impl Net for RealNet {
    fn get_blob(&self, _url: &str) -> Result<Vec<u8>, ArrowErr> {
        Err(ArrowErr::BlobFetch)
    }
    fn chat(&self, _key: &str, _body: &[u8]) -> Result<Vec<u8>, ArrowErr> {
        Err(ArrowErr::Llm)
    }
}
