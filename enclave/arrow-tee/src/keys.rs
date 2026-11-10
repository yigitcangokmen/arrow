//! Program key (DEC J-01), ECIES seal/unseal (DEC J-03, eciesjs 0.4 default profile) and the
//! XChaCha20-Poly1305 blob layout nonce(24) ‖ ct ‖ tag (DEC J-04). No `from_slice` on generic
//! arrays (it panics on a wrong length): arrays come from `try_into`.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use hkdf::Hkdf;
use k256::elliptic_curve::sec1::ToEncodedPoint;
use sha2::Sha256;

use arrow_core::ArrowErr;

use crate::consts::HKDF_INFO;

/// HKDF-SHA256(salt none, ikm = hex-decoded master, info "arrow/program/v1") → 32 bytes → scalar.
/// The OutLayer `hex32` secret length is undocumented, so 16..=64 bytes are accepted.
pub fn program_sk(master_hex: &str) -> Result<k256::SecretKey, ArrowErr> {
    let ikm = hex::decode(master_hex.trim()).map_err(|_| ArrowErr::Secret)?;
    if !(16..=64).contains(&ikm.len()) {
        return Err(ArrowErr::Secret);
    }
    let mut okm = [0u8; 32];
    Hkdf::<Sha256>::new(None, &ikm).expand(HKDF_INFO, &mut okm).map_err(|_| ArrowErr::Key)?;
    k256::SecretKey::from_slice(&okm).map_err(|_| ArrowErr::Key)
}

/// Uncompressed SEC1, lowercase hex: 130 chars starting with "04".
pub fn pk_hex(sk: &k256::SecretKey) -> String {
    hex::encode(sk.public_key().to_encoded_point(false).as_bytes())
}

/// 130 lowercase-or-uppercase hex chars, prefix 04, a point on the curve.
pub fn parse_buyer_pk(hex130: &str) -> Result<[u8; 65], ArrowErr> {
    if hex130.len() != 130 || !hex130.starts_with("04") {
        return Err(ArrowErr::BuyerKey);
    }
    let raw: [u8; 65] = hex::decode(hex130).map_err(|_| ArrowErr::BuyerKey)?.try_into().map_err(|_| ArrowErr::BuyerKey)?;
    k256::PublicKey::from_sec1_bytes(&raw).map_err(|_| ArrowErr::BuyerKey)?;
    Ok(raw)
}

/// Standard, padded base64 → ECIES decrypt; the plaintext must be at most `max_plain` bytes.
pub fn unseal(sk: &k256::SecretKey, b64: &str, max_plain: usize) -> Result<Vec<u8>, ArrowErr> {
    let ct = STANDARD.decode(b64).map_err(|_| ArrowErr::Unseal)?;
    let pt = ecies::decrypt(&sk.to_bytes(), &ct).map_err(|_| ArrowErr::Unseal)?;
    if pt.len() > max_plain {
        return Err(ArrowErr::Unseal);
    }
    Ok(pt)
}

pub fn seal_b64(buyer_pk: &[u8; 65], pt: &[u8]) -> Result<String, ArrowErr> {
    let ct = ecies::encrypt(buyer_pk, pt).map_err(|_| ArrowErr::Seal)?;
    Ok(STANDARD.encode(ct))
}

pub fn xchacha_open(k: &[u8; 32], blob: &[u8]) -> Result<Vec<u8>, ArrowErr> {
    let nonce: [u8; 24] = blob.get(..24).ok_or(ArrowErr::Decrypt)?.try_into().map_err(|_| ArrowErr::Decrypt)?;
    let ct = blob.get(24..).ok_or(ArrowErr::Decrypt)?;
    XChaCha20Poly1305::new(&(*k).into()).decrypt(&XNonce::from(nonce), ct).map_err(|_| ArrowErr::Decrypt)
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use k256::elliptic_curve::ops::Reduce;
    use serde_json::Value;
    use sha2::Digest;

    pub fn test_master() -> String {
        hex::encode(Sha256::digest(b"arrow/test/master/v1"))
    }

    /// fixtures/README.md label keys: sk = sha256(label) mod n.
    pub fn label_sk(label: &str) -> k256::SecretKey {
        let s = <k256::Scalar as Reduce<k256::U256>>::reduce_bytes(&Sha256::digest(label.as_bytes()));
        k256::SecretKey::from(Option::<k256::NonZeroScalar>::from(k256::NonZeroScalar::new(s)).unwrap())
    }

    fn fixture(name: &str) -> Value {
        let p = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/").to_string() + name;
        serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
    }

    fn hx(v: &Value, k: &str) -> Vec<u8> {
        hex::decode(v[k].as_str().unwrap()).unwrap()
    }

    #[test]
    fn hkdf_program_key_deterministic() {
        let a = program_sk(&test_master()).unwrap();
        let b = program_sk(&test_master()).unwrap();
        assert_eq!(a.to_bytes(), b.to_bytes());
        // independent restatement of DEC J-01
        let mut okm = [0u8; 32];
        Hkdf::<Sha256>::new(None, &Sha256::digest(b"arrow/test/master/v1")).expand(b"arrow/program/v1", &mut okm).unwrap();
        assert_eq!(a.to_bytes().as_slice(), okm.as_slice());
        assert_ne!(program_sk(&"11".repeat(32)).unwrap().to_bytes(), a.to_bytes());
    }

    #[test]
    fn program_pk_is_130_hex_04() {
        let pk = pk_hex(&program_sk(&test_master()).unwrap());
        assert_eq!(pk.len(), 130);
        assert!(pk.starts_with("04"));
        assert!(pk.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)));
    }

    #[test]
    fn master_rejects_short_or_nonhex() {
        assert_eq!(program_sk("zz").unwrap_err(), ArrowErr::Secret);
        assert_eq!(program_sk(&"ab".repeat(8 - 1)).unwrap_err(), ArrowErr::Secret);
        assert_eq!(program_sk(&"ab".repeat(65)).unwrap_err(), ArrowErr::Secret);
        assert_eq!(program_sk("").unwrap_err(), ArrowErr::Secret);
        assert!(program_sk(&"ab".repeat(16)).is_ok());
        assert!(program_sk(&"ab".repeat(64)).is_ok());
    }

    #[test]
    fn buyer_pk_rejects_compressed_and_offcurve() {
        let pk = pk_hex(&label_sk("arrow:test:buyer:v1"));
        assert!(parse_buyer_pk(&pk).is_ok());
        let compressed = hex::encode(label_sk("arrow:test:buyer:v1").public_key().to_encoded_point(true).as_bytes());
        assert_eq!(parse_buyer_pk(&compressed), Err(ArrowErr::BuyerKey));
        let off = format!("04{}", "11".repeat(64));
        assert_eq!(parse_buyer_pk(&off), Err(ArrowErr::BuyerKey));
        assert_eq!(parse_buyer_pk(pk.get(..128).unwrap()), Err(ArrowErr::BuyerKey));
        assert_eq!(parse_buyer_pk(&format!("05{}", pk.get(2..).unwrap())), Err(ArrowErr::BuyerKey));
        assert_eq!(parse_buyer_pk(&format!("04{}zz", pk.get(2..128).unwrap())), Err(ArrowErr::BuyerKey));
    }

    #[test]
    fn ecies_vectors_ts_to_rust() {
        let f = fixture("ecies-vectors.json");
        let cases = f["cases"].as_array().unwrap();
        assert!(!cases.is_empty());
        for c in cases {
            let sk = k256::SecretKey::from_slice(&hx(c, "scalar_hex")).unwrap();
            let b64 = STANDARD.encode(hx(c, "ciphertext_hex"));
            assert_eq!(unseal(&sk, &b64, 1 << 20).unwrap(), hx(c, "plaintext_hex"), "{}", c["id"]);
        }
    }

    #[test]
    fn xchacha_vectors_ts_to_rust() {
        let f = fixture("xchacha-vectors.json");
        let cases = f["cases"].as_array().unwrap();
        assert!(!cases.is_empty());
        for c in cases {
            let k: [u8; 32] = hx(c, "key_hex").try_into().unwrap();
            assert_eq!(xchacha_open(&k, &hx(c, "blob_hex")).unwrap(), hx(c, "plaintext_hex"), "{}", c["id"]);
        }
        assert_eq!(xchacha_open(&[0; 32], &[0; 10]), Err(ArrowErr::Decrypt));
        assert_eq!(xchacha_open(&[0; 32], &[0; 40]), Err(ArrowErr::Decrypt));
    }

    #[test]
    fn seal_unseal_roundtrip_and_limits() {
        let sk = label_sk("arrow:test:buyer:v1");
        let pk: [u8; 65] = parse_buyer_pk(&pk_hex(&sk)).unwrap();
        let s = seal_b64(&pk, &[7]).unwrap();
        assert_eq!(STANDARD.decode(&s).unwrap().len(), 98);
        assert_eq!(unseal(&sk, &s, 1).unwrap(), vec![7]);
        assert_eq!(unseal(&sk, &seal_b64(&pk, &[1, 2]).unwrap(), 1), Err(ArrowErr::Unseal));
        assert_eq!(unseal(&sk, "not base64!", 64), Err(ArrowErr::Unseal));
        assert_eq!(unseal(&sk, "AAAA", 64), Err(ArrowErr::Unseal));
        let other = label_sk("arrow:test:other:v1");
        assert_eq!(unseal(&other, &s, 64), Err(ArrowErr::Unseal));
    }
}
