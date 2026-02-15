use anchor_lang::prelude::*;

declare_id!("6i4KGtUUZVSxiJfwySQAoKQVo14FZyaSNUBuKPsJD5cj");

pub mod instructions;
// pub mod instructions_fromtests;
pub mod state;

pub use instructions::*;
// pub use instructions_fromtests::*;
pub use state::*;

#[program]
pub mod simple_escrow {
    use super::*;

    pub fn make(ctx: Context<Make>, seed: u64, deposit: u64, receive: u64) -> Result<()> {
        ctx.accounts.init_escrow(seed, receive, &ctx.bumps)?;
        ctx.accounts.deposit(deposit)?;
        Ok(())
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        ctx.accounts.refund_and_close_vault()
    }

    pub fn take(ctx: Context<Take>) -> Result<()> {
        ctx.accounts.deposit()?;
        ctx.accounts.withdraw_and_close_vault()
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    pub maker: Signer<'info>,
}
