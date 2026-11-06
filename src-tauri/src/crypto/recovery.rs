use zeroize::Zeroizing;

use crate::crypto::aead::random_key;
use crate::error::{AppError, Result};

/// Crockford base32: no I, L, O or U, so the key is hard to mistype.
const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// A recovery key is 256 bits shown as 52 base32 characters, grouped in fours.
pub fn generate() -> Zeroizing<String> {
    let key = random_key();
    Zeroizing::new(encode(&key[..]))
}

pub fn encode(key: &[u8]) -> String {
    let mut chars = String::with_capacity(52);
    let mut buffer: u32 = 0;
    let mut bits: u32 = 0;
    for byte in key {
        buffer = (buffer << 8) | u32::from(*byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            let symbol = ((buffer >> bits) & 0x1f) as usize;
            chars.push(ALPHABET[symbol] as char);
        }
    }
    if bits > 0 {
        let symbol = ((buffer << (5 - bits)) & 0x1f) as usize;
        chars.push(ALPHABET[symbol] as char);
    }
    chars
        .as_bytes()
        .chunks(4)
        .map(|chunk| std::str::from_utf8(chunk).expect("base32 is ASCII"))
        .collect::<Vec<_>>()
        .join("-")
}

/// Accept dashes, spaces and lowercase; map the usual Crockford confusions.
pub fn decode(input: &str) -> Result<Zeroizing<[u8; 32]>> {
    let mut chars = Vec::with_capacity(52);
    for character in input.chars() {
        if character.is_whitespace() || character == '-' {
            continue;
        }
        let upper = character.to_ascii_uppercase();
        let mapped = match upper {
            'I' | 'L' => '1',
            'O' => '0',
            other => other,
        };
        if !ALPHABET.contains(&(mapped as u8)) {
            return Err(AppError::Invalid(
                "That recovery key is not valid. Check the characters and try again.".into(),
            ));
        }
        chars.push(mapped);
    }
    if chars.len() != 52 {
        return Err(AppError::Invalid(
            "A recovery key is 52 characters long.".into(),
        ));
    }

    let mut out = Zeroizing::new([0u8; 32]);
    let mut buffer: u32 = 0;
    let mut bits: u32 = 0;
    let mut written = 0usize;
    for character in chars {
        let value = ALPHABET
            .iter()
            .position(|candidate| *candidate == character as u8)
            .ok_or(AppError::MalformedVault)? as u32;
        buffer = (buffer << 5) | value;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            if written >= out.len() {
                return Err(AppError::MalformedVault);
            }
            out[written] = ((buffer >> bits) & 0xff) as u8;
            written += 1;
        }
    }
    if written != 32 {
        return Err(AppError::MalformedVault);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let key = random_key();
        let text = encode(&key[..]);
        assert_eq!(text.chars().filter(|c| *c != '-').count(), 52);
        let decoded = decode(&text).unwrap();
        assert_eq!(decoded.as_ref(), key.as_ref());
    }

    #[test]
    fn accepts_lowercase_and_confusable_characters() {
        let key = random_key();
        let text = encode(&key[..])
            .to_lowercase()
            .replace('1', "i")
            .replace('0', "o");
        let decoded = decode(&text).unwrap();
        assert_eq!(decoded.as_ref(), key.as_ref());
    }

    #[test]
    fn rejects_short_or_invalid_keys() {
        assert!(decode("ABC").is_err());
        assert!(decode(&"U".repeat(52)).is_err());
        assert!(decode(&"!".repeat(52)).is_err());
    }

    #[test]
    fn generated_keys_are_unique() {
        let a = generate();
        let b = generate();
        assert_ne!(*a, *b);
    }
}
