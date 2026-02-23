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
    #[msg("Proof is invalid")]
    InvalidProof,
    #[msg("Missing proof")]
    MissingProof,
    #[msg("Claim amount is invalid")]
    InvalidClaimAmount,
    #[msg("Vault is not active")]
    VaultNotActive,
    #[msg("Vesting calculation overflow")]
    VestingOverflow,
    #[msg("Schedule error")]
    ScheduleError,
    #[msg("Transfer failed")]
    TransferFailed,
}
