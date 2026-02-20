use anchor_lang::prelude::*;


// should we pass error params to show faulty values?

#[error_code]
pub enum MyError {
    #[msg("Merkle root is invalid")]
    InvalidMerkleRoot,
    #[msg("Time window is invalid")]
    InvalidTimeWindow,
    #[msg("User allocation is invalid")]
    InvalidUserAllocation,
}