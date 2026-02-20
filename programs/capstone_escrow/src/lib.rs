use anchor_lang::prelude::*;

declare_id!("3uc4VYyZysCNZ3zKGbcbNnARFi2fHEPrBSSCXGC5Qjwf");

pub mod instructions;
pub mod state;
pub mod errors;

pub use instructions::*;
pub use state::*;
pub use errors::*;

#[program]
pub mod capstone_escrow {
    use super::*;

    pub fn initialize(ctx: Context<Init>, seed: u64, merkle_root: [u8; 32], start_timestamp: u64, end_timestamp: u64, user_allocation: u64, deposit: u64) -> Result<()> {
        ctx.accounts.init_vault(seed, merkle_root, start_timestamp, end_timestamp, user_allocation, &ctx.bumps)?;
        ctx.accounts.deposit(deposit)?;
        Ok(())
    }
}


