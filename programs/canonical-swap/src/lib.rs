use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, SetAuthority, TokenAccount, Transfer};
use spl_token::instruction::AuthorityType;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod canonical_swap {
    use super::*;

    const CANONICAL_MINT_AUTHORITY_PDA_SEED: &[u8] = b"can_mint_authority";
    const WRAPPED_TOKEN_OWNER_AUTHORITY_PDA_SEED: &[u8] = b"wrapped_acct_authority";

    pub fn initialize_canonical_token(
        ctx: Context<InitializeCanonicalToken>,
        decimals: u8,
    ) -> ProgramResult {
        // Set canonical token data
        ctx.accounts.canonical_data.initializer = *ctx.accounts.initializer.key;
        ctx.accounts.canonical_data.mint = *ctx.accounts.canonical_mint.to_account_info().key;
        ctx.accounts.canonical_data.decimals = decimals;

        // Take over mint authority for canonical token
        let cpi_accounts = SetAuthority {
            current_authority: ctx.accounts.initializer.to_account_info(),
            account_or_mint: ctx.accounts.canonical_mint.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);

        let (mint_authority, _sale_authority_bump) =
            Pubkey::find_program_address(&[CANONICAL_MINT_AUTHORITY_PDA_SEED], ctx.program_id);

        token::set_authority(cpi_ctx, AuthorityType::MintTokens, Some(mint_authority))?;
        Ok(())
    }

    pub fn initialize_wrapped_token(
        ctx: Context<InitializeWrappedToken>,
        decimals: u8,
        _vault_account_bump: u8,
    ) -> ProgramResult {
        // Set wrapped token data
        ctx.accounts.wrapped_data.canonical_data =
            *ctx.accounts.canonical_data.to_account_info().key;
        ctx.accounts.wrapped_data.mint = *ctx.accounts.wrapped_token_mint.to_account_info().key;
        ctx.accounts.wrapped_data.decimals = decimals;

        // Take ownership of token account for storage of wrapped
        let cpi_accounts = SetAuthority {
            current_authority: ctx.accounts.initializer.to_account_info(),
            account_or_mint: ctx.accounts.wrapped_token_account.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);

        let (wrapped_token_pda_authority, _wrapped_token_pda_authority_bump) =
            Pubkey::find_program_address(&[WRAPPED_TOKEN_OWNER_AUTHORITY_PDA_SEED], ctx.program_id);
        token::set_authority(
            cpi_ctx,
            AuthorityType::AccountOwner,
            Some(wrapped_token_pda_authority),
        )?;
        Ok(())
    }

    pub fn swap_wrapped_for_canonical(
        ctx: Context<SwapWrappedForCanonical>,
        canonical_amount: u64,
    ) -> ProgramResult {
        let wrapped_decimals = ctx.accounts.wrapped_data.decimals as u32;
        let canonical_decimals = ctx.accounts.canonical_data.decimals as u32;

        let mut wrapped_amount = canonical_amount;

        if canonical_decimals > wrapped_decimals {
            let decimal_diff = canonical_decimals - wrapped_decimals;
            let conversion_factor = 10u64.pow(decimal_diff);
            wrapped_amount = canonical_amount / conversion_factor;
        } else if canonical_decimals < wrapped_decimals {
            let decimal_diff = wrapped_decimals - canonical_decimals;
            let conversion_factor = 10u64.pow(decimal_diff);
            wrapped_amount = canonical_amount * conversion_factor;
        }

        let cpi_accounts = Transfer {
            from: ctx.accounts.source_wrapped_token_account.to_account_info(),
            to: ctx.accounts.wrapped_token_account.to_account_info(),
            authority: ctx.accounts.destination_signer.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, wrapped_amount)?;

        let cpi_accounts = MintTo {
            to: ctx
                .accounts
                .destination_canonical_token_account
                .to_account_info(),
            mint: ctx.accounts.canonical_mint.to_account_info(),
            authority: ctx.accounts.canonical_mint_authority.to_account_info(),
        };

        let (_authority, authority_bump) =
            Pubkey::find_program_address(&[CANONICAL_MINT_AUTHORITY_PDA_SEED], ctx.program_id);
        let authority_seeds = &[&CANONICAL_MINT_AUTHORITY_PDA_SEED[..], &[authority_bump]];

        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::mint_to(
            cpi_ctx.with_signer(&[&authority_seeds[..]]),
            canonical_amount,
        )?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeCanonicalToken<'info> {
    // must have minting authority for canonical token
    pub initializer: Signer<'info>,

    // Canonical spl-token mint account
    // THIS METHOD WILL TRANSFER MINT AUTHORITY TO A PDA
    #[account(mut)]
    pub canonical_mint: Account<'info, Mint>,

    #[account(zero)]
    pub canonical_data: Box<Account<'info, CanonicalData>>,

    #[account(address = token::ID)]
    pub token_program: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(decimals: u8, wrapped_token_account_bump: u8)]
pub struct InitializeWrappedToken<'info> {
    #[account(mut)]
    pub initializer: Signer<'info>,
    pub wrapped_token_mint: Account<'info, Mint>,

    // initializer will start out with owernship of this token account.
    // THIS METHOD WILL TRANSFER OWNERSHIP AUTHORITY TO A PDA
    // after initialization this token account will hold all wrapped tokens
    #[account(
        init,
        seeds = [b"token-account-seed".as_ref()],
        bump = wrapped_token_account_bump,
        payer = initializer,
        token::mint = wrapped_token_mint,
        token::authority = initializer,
    )]
    pub wrapped_token_account: Account<'info, TokenAccount>,

    // ensure that initializer for a given wrapped token has already initialized
    // a canonical token to pair with
    #[account(
        constraint = canonical_data.initializer == *initializer.key,
    )]
    pub canonical_data: Box<Account<'info, CanonicalData>>,

    #[account(zero)]
    pub wrapped_data: Box<Account<'info, WrappedData>>,

    #[account(address = token::ID)]
    pub token_program: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(canonical_amount: u64)]
pub struct SwapWrappedForCanonical<'info> {
    // any signer
    pub destination_signer: Signer<'info>,
    // Token account for resulting canonical tokens
    #[account(mut)]
    pub destination_canonical_token_account: Account<'info, TokenAccount>,
    // Canonical mint account
    #[account(mut)]
    pub canonical_mint: Account<'info, Mint>,
    // PDA owning the mint authority
    pub canonical_mint_authority: AccountInfo<'info>,

    #[account(mut)]
    pub source_wrapped_token_account: Account<'info, TokenAccount>,
    pub wrapped_token_mint: Account<'info, Mint>,
    #[account(mut)]
    pub wrapped_token_account: Account<'info, TokenAccount>,

    #[account(
        constraint = canonical_data.mint == *canonical_mint.to_account_info().key,
    )]
    pub canonical_data: Box<Account<'info, CanonicalData>>,

    #[account(
        has_one = canonical_data,
    )]
    pub wrapped_data: Box<Account<'info, WrappedData>>,

    #[account(address = token::ID)]
    pub token_program: AccountInfo<'info>,
}

#[account]
pub struct CanonicalData {
    pub initializer: Pubkey,
    pub mint: Pubkey,
    pub decimals: u8,
}

#[account]
pub struct WrappedData {
    pub canonical_data: Pubkey,
    pub mint: Pubkey,
    pub decimals: u8,
}
