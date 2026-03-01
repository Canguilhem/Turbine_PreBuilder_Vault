use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token_interface::{Mint, TokenAccount, TokenInterface}};

use crate::{ClaimVault, MyError, Vault, close_token_account, transfer_tokens};

#[derive(Accounts)]
pub struct Clawback<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,

    #[account(
        mut, 
        seeds = [b"vault", maker.key().as_ref(), vault.seed.to_le_bytes().as_ref()],
        constraint = vault.maker == maker.key(),
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(mint::token_program = token_program)]
    pub mint_to_claim: InterfaceAccount<'info, Mint>,

    /// CHECK: used for PDA derivation
    pub user: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"claim_vault", vault.key().as_ref(), user.key().as_ref()],
        bump = user_vault.bump,
        constraint = user_vault.user == user.key(),
        close = maker,
    )]
    pub user_vault: Account<'info, ClaimVault>,

    #[account(
        mut,
        associated_token::mint = mint_to_claim,
        associated_token::authority = user_vault,
        associated_token::token_program = token_program
    )]
    pub user_vault_ata: Option<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = mint_to_claim,
        associated_token::authority = vault,
        associated_token::token_program = token_program
    )]
    pub vault_ata: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>, // should we directly store this in vault and use ref here?
    pub associated_token_program: Program<'info, AssociatedToken>,
}

impl<'info> Clawback<'info> {
    // clawback tokens from user_vault_ata to vault_ata if it exists
    // then close both user_vault and user_vault_ata
    // note: user_vault is closed automatically due to constraint in accounts
    pub fn clawback(&mut self) -> Result<()> {

        require!(
            self.vault.has_ended()?,
            MyError::GracePeriodNotEnded
        );


        let vault_key = self.vault.key();
        let user_key = self.user.key();
        let user_vault_signer: &[&[u8]] = &[
            b"claim_vault",
            vault_key.as_ref(),
            user_key.as_ref(),
            &[self.user_vault.bump],
        ];

        if let Some(user_vault_ata) = &self.user_vault_ata {
            


            require!(user_vault_ata.amount > 0, MyError::InvalidAmount);

            transfer_tokens(
                user_vault_ata,
                &self.vault_ata,
                &user_vault_ata.amount,
                &self.mint_to_claim,
                &self.user_vault.to_account_info(),
                &self.token_program,
                Some(user_vault_signer),
            )?;

            close_token_account(
                user_vault_ata,
                &self.maker.to_account_info(),
                &self.user_vault.to_account_info(),
                &self.token_program,
                Some(user_vault_signer),
            )?;
        }

        Ok(())
    }
}