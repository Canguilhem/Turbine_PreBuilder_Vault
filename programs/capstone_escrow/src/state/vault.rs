use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub merkle_root: [u8; 32], // 32 bytes
    pub start_timestamp: u64,
    pub end_timestamp: u64,
    pub seed: u64,
    pub maker: Pubkey,
    pub token_to_claim: Pubkey,
    pub user_allocation: u64,
    pub grace_period: u64, // period of time after end_timestamp where maker can clawback/close the vault
    pub bump: u8,
}

impl Vault {
    pub fn has_ended(&self) -> Result<bool> {
        Ok(Clock::get()?.unix_timestamp as u64 >= self.end_timestamp + self.grace_period)
    }
}
