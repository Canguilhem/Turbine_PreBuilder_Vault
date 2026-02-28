use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
    
};

use crate::{ClaimEvent, close_token_account, transfer_tokens, utils::merkletree::{leaf_hash, verify}};
use crate::{ClaimVault, MyError, Vault};

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut,
        seeds = [b"vault", vault.maker.as_ref(), vault.seed.to_le_bytes().as_ref()],
        bump = vault.bump)]
    pub vault: Account<'info, Vault>,

    #[account(
        init_if_needed,
        payer = user,
        space = ClaimVault::DISCRIMINATOR.len() + ClaimVault::INIT_SPACE,
        // using vault and user keys to ensure a same user can be referenced in multiple schedule
        seeds = [b"claim_vault", vault.key().as_ref(),  user.key().as_ref()],
        bump
    )]
    pub user_vault: Account<'info, ClaimVault>,

    #[account(mint::token_program = token_program)]
    pub mint_to_claim: InterfaceAccount<'info, Mint>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint_to_claim,
        associated_token::authority = user_vault,
        associated_token::token_program = token_program
    )]
    pub user_vault_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint_to_claim,
        associated_token::authority = user,
        associated_token::token_program = token_program
    )]
    pub user_ata: InterfaceAccount<'info, TokenAccount>,

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

impl<'info> Claim<'info> {
    pub fn claim(&mut self, proofs: Vec<[u8; 33]>, bumps: &ClaimBumps) -> Result<()> {
        let now = Clock::get()?.unix_timestamp as u64;
        let allocation = self.vault.user_allocation;

        require!(
            !self.vault.has_ended()?,
            MyError::VaultNotActive
        );

        // if first claim, verify proof
        if self.user_vault.last_claim_timestamp == 0 {
            require!(!proofs.is_empty(), MyError::MissingProof);

            let leaf_hash = leaf_hash(&self.user.key(), allocation);
            let is_valid = verify(leaf_hash, &proofs, &self.vault.merkle_root);
            require!(is_valid, MyError::InvalidProof);

            // 2 transfers:
            let claimable = self.calculate_claim_amount(self.user_vault.amount)?;
            let unvested = allocation - claimable;

            require!(claimable > 0 || unvested > 0, MyError::InvalidAmount);

            let vault_seeds = &[
                b"vault",
                self.vault.maker.as_ref(),
                &self.vault.seed.to_le_bytes(),
                &[self.vault.bump],
            ];
            let vault_signer = Some(&vault_seeds[..]);

            // 1. unvested amount to user_vault_ata
            if unvested > 0 {
                transfer_tokens(
                    &self.vault_ata,
                    &self.user_vault_ata,
                    &unvested,
                    &self.mint_to_claim,
                    &self.vault.to_account_info(),
                    &self.token_program,
                    vault_signer,
                )?;

            }

            // 2. vested amount to user_ata
            if claimable > 0 {
                transfer_tokens(
                    &self.vault_ata,
                    &self.user_ata,
                    &claimable,
                    &self.mint_to_claim,
                    &self.vault.to_account_info(),
                    &self.token_program,
                    vault_signer,
                )?;
            }

            self.update_user_vault(claimable, now, bumps)?;

        } else {
            // transfer from user_vault_ata to user_ata

            let claimable = self.calculate_claim_amount(self.user_vault.amount)?;

            require!(claimable > 0, MyError::InvalidAmount);

            let vault_key = self.vault.key();
            let user_key = self.user.key();
            let user_vault_bump = [self.user_vault.bump];
            let user_vault_seeds = &[
                b"claim_vault",
                vault_key.as_ref(),
                user_key.as_ref(),
                user_vault_bump.as_ref(),
            ];
            let user_vault_signer = Some(&user_vault_seeds[..]);

            transfer_tokens(
                &self.user_vault_ata,
                &self.user_ata,
                &claimable,
                &self.mint_to_claim,
                &self.user_vault.to_account_info(),
                &self.token_program,
                user_vault_signer,
            )?;

            self.update_user_vault(claimable, now, bumps)?;
            
        }

        Ok(())
    }

    // time based claim calculation
    fn calculate_claim_amount(&self, amount_claimed_so_far: u64) -> Result<u64> {
        let clock = Clock::get()?;

        let now = clock.unix_timestamp as u64;
        let start = self.vault.start_timestamp;
        let end = self.vault.end_timestamp;
        
        let allocation = self.vault.user_allocation;
    
        let vested = if now <= start {
            0
        } else if now >= end {
            allocation
        } else {
            let elapsed = now.checked_sub(start).ok_or(MyError::ScheduleError)?;
            let time_window = end.checked_sub(start).ok_or(MyError::ScheduleError)?;
            require!(time_window > 0, MyError::ScheduleError);
    
    // using u128 to avoid overflow while multiplying/dividing
            let vested_u128 = (allocation as u128)
                .checked_mul(elapsed as u128)
                .and_then(|v| v.checked_div(time_window as u128))
                .ok_or(MyError::MathOverflow)?;
    
            u64::try_from(vested_u128).map_err(|_| MyError::MathOverflow)?
        };
    
       Ok(vested
            .checked_sub(amount_claimed_so_far)
            .ok_or(MyError::MathOverflow)?)
    }

    // keep user_vault open to prevent double claiming
    fn close_user_claim_accounts(&mut self) -> Result<()> {

        let user_vault_bump = [self.user_vault.bump];
        let vault_key = self.vault.key();
        let user_key = self.user.key();
        let claim_vault_seeds = &[
            b"claim_vault",
            vault_key.as_ref(),
            user_key.as_ref(),
            user_vault_bump.as_ref(),
        ];
        close_token_account(
            &self.user_vault_ata,
            &self.user.to_account_info(),
            &self.user_vault.to_account_info(),
            &self.token_program,
            Some(claim_vault_seeds),
        )?;

        Ok(())
    
    }


    fn update_user_vault(&mut self, claimable: u64, now: u64, bumps: &ClaimBumps) -> Result<()> {

        let new_amount = self.user_vault.amount + claimable;
        
        self.user_vault.set_inner(ClaimVault {
            user: self.user.key(),
            amount: new_amount,
            last_claim_timestamp: now,
            bump: bumps.user_vault,
        });

        if new_amount == self.vault.user_allocation {
            self.close_user_claim_accounts()?;
        }

        emit!(ClaimEvent {
            user: self.user.key(),
            amount: new_amount,
            last_claim_timestamp: now,
        });

        Ok(())
    }
}
