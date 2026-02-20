use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked}};

use crate::{errors::MyError, Vault};

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct Init<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    
    #[account(init, payer=payer, space=8+ Vault::INIT_SPACE, seeds = [b"vault", payer.key().as_ref(), seed.to_le_bytes().as_ref()], bump)]
    pub vault: Account<'info, Vault>,

    #[account(mint::token_program = token_program)]
    pub mint_to_claim: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint_to_claim,
        associated_token::authority = payer,
        associated_token::token_program = token_program
    )]
    pub payer_ata_to_claim: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

impl<'info> Init<'info> {
    pub fn init_vault(&mut self, seed: u64, merkle_root: [u8; 32], start_timestamp: u64, end_timestamp: u64, user_allocation: u64, bumps: &InitBumps) -> Result<()> {

        self.validate_init_vault(&merkle_root, &start_timestamp, &end_timestamp, &user_allocation)?;

        self.vault.set_inner(Vault {
            merkle_root,
            start_timestamp,
            end_timestamp,
            seed,
            maker: self.payer.key(),
            token_to_claim: self.mint_to_claim.key(),
            user_allocation: user_allocation,
            bump: bumps.vault,
        });
        Ok(())
    }

    pub fn deposit(&mut self, deposit: u64) -> Result<()> {
        let transfer_accounts = TransferChecked {
            from: self.payer_ata_to_claim.to_account_info(),
            mint: self.mint_to_claim.to_account_info(),
            to: self.vault.to_account_info(),
            authority: self.payer.to_account_info(),
        };
    
        let cpi_ctx = CpiContext::new(self.token_program.to_account_info(), transfer_accounts);
        transfer_checked(cpi_ctx, deposit, self.mint_to_claim.decimals)
    }


    // validations
    // - merkle root is 32 bytes
    // - start timestamp is not 0
    // - end timestamp is not 0
    // - start timestamp is less than end timestamp
    // - user allocation is positive
    fn validate_init_vault(&self, merkle_root: &[u8; 32], start_timestamp: &u64, end_timestamp: &u64, user_allocation: &u64) -> Result<()> {
        
        if merkle_root.len() != 32 { // 32 bytes
            return err!(MyError::InvalidMerkleRoot);
        }
        if *start_timestamp == 0 || *end_timestamp == 0 || *start_timestamp >= *end_timestamp {
            return err!(MyError::InvalidTimeWindow);
        }
        if *user_allocation > 0 {
            return err!(MyError::InvalidUserAllocation);
        }
        Ok(())
    }

}

