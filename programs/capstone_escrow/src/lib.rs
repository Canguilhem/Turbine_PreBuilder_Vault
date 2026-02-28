use anchor_lang::prelude::*;

declare_id!("3uc4VYyZysCNZ3zKGbcbNnARFi2fHEPrBSSCXGC5Qjwf");

pub mod errors;
pub mod instructions;
pub mod state;

pub use errors::*;
pub use instructions::*;
pub use state::*;
pub mod utils;
pub use utils::*;

#[program]
pub mod capstone_escrow {
    use super::*;

    pub fn initialize(
        ctx: Context<Init>,
        seed: u64,
        merkle_root: [u8; 32],
        start_timestamp: u64,
        end_timestamp: u64,
        user_allocation: u64,
        clawback_buffer: u64,
        deposit: u64,
    ) -> Result<()> {
        ctx.accounts.init_vault(
            seed,
            merkle_root,
            start_timestamp,
            end_timestamp,
            user_allocation,
            clawback_buffer,
            &ctx.bumps,
        )?;
        ctx.accounts.deposit(deposit)?;
        Ok(())
    }

    pub fn claim(ctx: Context<Claim>, proofs: Vec<[u8; 33]>) -> Result<()> {
        ctx.accounts.claim(proofs, &ctx.bumps)?;
        Ok(())
    }

    pub fn close_vault(ctx: Context<CloseVault>) -> Result<()> {
        ctx.accounts.close_vault()?;
        Ok(())
    }

    pub fn clawback(ctx: Context<Clawback>) -> Result<()> {
        ctx.accounts.clawback()?;
        Ok(())
    }
}
