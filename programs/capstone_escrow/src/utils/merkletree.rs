use solana_program::keccak::hash as keccak256;
use solana_program::pubkey::Pubkey;

pub fn leaf_hash(pubkey: &Pubkey, amount: u64) -> [u8; 32] {
    let addr = pubkey.to_string().to_lowercase();
    let leaf_str = format!("{}{}", addr, amount);
    keccak256(leaf_str.as_bytes()).to_bytes()
}

/// Proof format "0x00" + hash or "0x01" + hash
/// - position 0: we're right child → hash(sibling, current)
/// - position 1: we're left child  → hash(current, sibling)
pub fn verify(
    leaf_hash: [u8; 32],
    proof: &[[u8; 33]],  // [position (1 byte)][hash (32 bytes)] per step
    root: &[u8; 32],
) -> bool {
    let mut hash = leaf_hash;

    for step in proof {
        let position = step[0];  // 0 or 1
        let sibling: &[u8; 32] = step[1..33].try_into().unwrap();

        let mut combined = [0u8; 64];
        if position == 1 {
            // We're left child: hash(current, sibling)
            combined[0..32].copy_from_slice(&hash);
            combined[32..64].copy_from_slice(sibling);
        } else {
            // We're right child (position 0): hash(sibling, current)
            combined[0..32].copy_from_slice(sibling);
            combined[32..64].copy_from_slice(&hash);
        }
        hash = keccak256(&combined).to_bytes();
    }

    &hash == root
}