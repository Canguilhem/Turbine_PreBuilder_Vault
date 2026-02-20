use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Vault {
    #[max_len(256)]
    pub merkle_root: [u8; 32], // 32 bytes
    pub start_timestamp: u64,
    pub end_timestamp: u64,
    pub seed: u64,
    pub maker: Pubkey,
    pub token_to_claim: Pubkey,
    pub user_allocation: u64,
    pub bump: u8,
}

impl Vault {
    pub fn has_ended(&self) -> Result<bool> {
        Ok(Clock::get()?.unix_timestamp as u64 >= self.end_timestamp)
    }

    pub fn has_started(&self) -> Result<bool> {
        Ok(Clock::get()?.unix_timestamp as u64 >= self.start_timestamp)
    }
    pub fn is_active(&self) -> Result<bool> {
        Ok(self.has_started()? && !self.has_ended()?)
    }


}