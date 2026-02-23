use anchor_lang::prelude::*;
#[account]
#[derive(InitSpace)]
pub struct ClaimVault {
    pub user: Pubkey,
    pub amount: u64,
    pub last_claim_timestamp: u64,
    pub bump: u8,
}
