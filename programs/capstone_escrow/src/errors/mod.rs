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
    #[msg("Deposit is invalid")]
    InvalidDeposit,
    #[msg("Proof is invalid")]
    InvalidProof,
    #[msg("Missing proof")]
    MissingProof,
    #[msg("Amount is invalid")]
    InvalidAmount,
    #[msg("Vault is not active")]
    VaultNotActive,
    #[msg("Calculation overflow")]
    MathOverflow,
    #[msg("Schedule error")]
    ScheduleError,
    #[msg("Transfer failed")]
    TransferFailed,
    #[msg("Clawback period is invalid")]
    InvalidClawbackPeriod,
    #[msg("Grace period not ended")]
    GracePeriodNotEnded,
}
