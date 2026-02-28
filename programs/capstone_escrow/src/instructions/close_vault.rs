use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token_interface::{Mint, TokenAccount, TokenInterface}};

use crate::{MyError, Vault, close_token_account, transfer_tokens};

#[derive(Accounts)]
pub struct CloseVault<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault.maker.as_ref(), vault.seed.to_le_bytes().as_ref()],
        bump = vault.bump,
        constraint = vault.maker == maker.key(),
        close = maker
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mint::token_program = token_program
    )]
    pub mint_to_claim: InterfaceAccount<'info, Mint>,

    #[account(
        init_if_needed, // just in case ata have been closed somewhere else
        payer = maker,
        associated_token::mint = mint_to_claim,
        associated_token::authority = maker,
        associated_token::token_program = token_program
    )]
    pub maker_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint_to_claim,
        associated_token::authority = vault,
        associated_token::token_program = token_program
    )]
    pub vault_ata: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

impl<'info> CloseVault<'info> {
    pub fn close_vault(&mut self) -> Result<()> {
        require!(
            self.vault.has_ended()?,
            MyError::GracePeriodNotEnded
        );

        let balance = self.vault_ata.amount;

        let vault_seeds = &[
            b"vault",
            self.vault.maker.as_ref(),
            &self.vault.seed.to_le_bytes(),
            &[self.vault.bump],
        ];

        if balance > 0 {
            transfer_tokens(
                &self.vault_ata,
                &self.maker_ata,
                &balance,
                &self.mint_to_claim,
                &self.vault.to_account_info(),
                &self.token_program,
                Some(vault_seeds),
            )?;
        }

        close_token_account(
            &self.vault_ata,
            &self.maker.to_account_info(),
            &self.vault.to_account_info(),
            &self.token_program,
            Some(vault_seeds),
        )?;
    
        Ok(())
    }
}