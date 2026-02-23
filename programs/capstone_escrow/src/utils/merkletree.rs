use anchor_lang::prelude::*;
use sha3::{Digest, Keccak256};

pub fn leaf_hash(pubkey: &Pubkey, amount: u64) -> [u8; 32] {
    let addr = pubkey.to_string().to_lowercase();
    let leaf_str = format!("{}{}", addr, amount);
    let mut hasher = Keccak256::new();
    hasher.update(leaf_str.as_bytes());
    hasher.finalize().into()
}

/// Proof format "0x00" + hash or "0x01" + hash
/// - position 0: we're right child → hash(sibling, current)
/// - position 1: we're left child  → hash(current, sibling)
pub fn verify(leaf_hash: [u8; 32], proof: &[[u8; 33]], root: &[u8; 32]) -> bool {
    let mut hash = leaf_hash;

    for step in proof {
        let position = step[0];
        let sibling: &[u8; 32] = step[1..33].try_into().unwrap();

        let mut combined = [0u8; 64];
        if position == 1 {
            combined[0..32].copy_from_slice(&hash);
            combined[32..64].copy_from_slice(sibling);
        } else {
            combined[0..32].copy_from_slice(sibling);
            combined[32..64].copy_from_slice(&hash);
        }

        let mut hasher = Keccak256::new();
        hasher.update(&combined);
        hash = hasher.finalize().into();
    }

    &hash == root
}
