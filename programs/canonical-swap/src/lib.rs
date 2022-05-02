use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, MintTo, SetAuthority, TokenAccount, Transfer};
use spl_token::instruction::AuthorityType;
declare_id!("CSWAPqg5XDRcknL2CmDVtmBHX2KFEnaLZgHFCC89nhDk");

const CANONICAL_MINT_AUTHORITY_PDA_SEED: &[u8] = b"can_mint_authority";
const WRAPPED_TOKEN_ACCOUNT_PDA_SEED: &[u8] = b"token_account_seed";
const WRAPPED_TOKEN_OWNER_AUTHORITY_PDA_SEED: &[u8] = b"wrapped_acct_authority";

#[program]
pub mod canonical_swap {
    use super::*;

    /// Initialize a canonical token and transfer mint authority over to a PDA
    pub fn initialize_canonical_token(
        ctx: Context<InitializeCanonicalToken>,
        _canonical_mint_authority_bump: u8,
    ) -> ProgramResult {
        // Set canonical token data
        let canonical_data = &mut ctx.accounts.canonical_data;
        canonical_data.authority = *ctx.accounts.initializer.key;
        canonical_data.mint = *ctx.accounts.canonical_mint.to_account_info().key;
        canonical_data.decimals = ctx.accounts.canonical_mint.decimals;

        // Take over mint authority for canonical token
        let cpi_accounts = SetAuthority {
            current_authority: ctx.accounts.initializer.to_account_info(),
            account_or_mint: ctx.accounts.canonical_mint.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);

        token::set_authority(
            cpi_ctx,
            AuthorityType::MintTokens,
            Some(*ctx.accounts.pda_canonical_mint_authority.key),
        )?;
        Ok(())
    }

    /// Initialize a wrapped token paired to a canonical token
    pub fn initialize_wrapped_token(
        ctx: Context<InitializeWrappedToken>,
        _wrapped_token_account_bump: u8,
        _wrapped_token_account_authority_bump: u8,
    ) -> ProgramResult {
        // Set wrapped token data
        let wrapped_data = &mut ctx.accounts.wrapped_data;

        wrapped_data.canonical_data = *ctx.accounts.canonical_data.to_account_info().key;
        wrapped_data.mint = *ctx.accounts.wrapped_token_mint.to_account_info().key;
        wrapped_data.decimals = ctx.accounts.wrapped_token_mint.decimals;
        wrapped_data.paused = false;

        // Take ownership of token account for storage of wrapped
        let cpi_accounts = SetAuthority {
            current_authority: ctx.accounts.current_authority.to_account_info(),
            account_or_mint: ctx.accounts.pda_wrapped_token_account.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);

        token::set_authority(
            cpi_ctx,
            AuthorityType::AccountOwner,
            Some(*ctx.accounts.pda_wrapped_token_account_authority.key),
        )?;
        Ok(())
    }

    /// Transfer wrapped token to program owned token account and
    /// mint canonical token to user owned token account
    pub fn swap_wrapped_for_canonical(
        ctx: Context<SwapWrappedForCanonical>,
        canonical_amount: u64,
        canonical_mint_authority_bump: u8,
        _wrapped_token_account_bump: u8,
    ) -> ProgramResult {
        // Determine decimal conversion
        let wrapped_decimals = ctx.accounts.wrapped_data.decimals as u32;
        let canonical_decimals = ctx.accounts.canonical_data.decimals as u32;

        let mut wrapped_amount = canonical_amount;
        let mut calculated_canonical_amount = canonical_amount;

        if canonical_decimals > wrapped_decimals {
            let decimal_diff = canonical_decimals - wrapped_decimals;
            let conversion_factor = 10u64.pow(decimal_diff);
            wrapped_amount = canonical_amount / conversion_factor;
            calculated_canonical_amount = wrapped_amount * conversion_factor;
        } else if canonical_decimals < wrapped_decimals {
            let decimal_diff = wrapped_decimals - canonical_decimals;
            let conversion_factor = 10u64.pow(decimal_diff);
            wrapped_amount = canonical_amount * conversion_factor;
        }

        // Transfer wrapped tokens from user account to program account
        let cpi_accounts = Transfer {
            from: ctx.accounts.source_wrapped_token_account.to_account_info(),
            to: ctx.accounts.wrapped_token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, wrapped_amount)?;

        // Mint canonical tokens
        let cpi_accounts = MintTo {
            to: ctx
                .accounts
                .destination_canonical_token_account
                .to_account_info(),
            mint: ctx.accounts.canonical_mint.to_account_info(),
            authority: ctx.accounts.pda_canonical_mint_authority.to_account_info(),
        };

        let authority_seeds = &[
            CANONICAL_MINT_AUTHORITY_PDA_SEED,
            ctx.accounts.canonical_mint.to_account_info().key.as_ref(),
            &[canonical_mint_authority_bump],
        ];

        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::mint_to(
            cpi_ctx.with_signer(&[authority_seeds]),
            calculated_canonical_amount,
        )?;
        Ok(())
    }

    /// Burn canonical token from user account and
    /// transfer wrapped canonical token to user owned token account
    pub fn swap_canonical_for_wrapped(
        ctx: Context<SwapCanonicalForWrapped>,
        wrapped_amount: u64,
        wrapped_token_account_authority_bump: u8,
    ) -> ProgramResult {
        // Determine decimal conversion
        let wrapped_decimals = ctx.accounts.wrapped_data.decimals as u32;
        let canonical_decimals = ctx.accounts.canonical_data.decimals as u32;

        let mut canonical_amount = wrapped_amount;
        let mut calculated_wrapped_amount = wrapped_amount;

        if canonical_decimals > wrapped_decimals {
            let decimal_diff = canonical_decimals - wrapped_decimals;
            let conversion_factor = 10u64.pow(decimal_diff);
            canonical_amount = wrapped_amount * conversion_factor;
        } else if canonical_decimals < wrapped_decimals {
            let decimal_diff = wrapped_decimals - canonical_decimals;
            let conversion_factor = 10u64.pow(decimal_diff);
            canonical_amount = wrapped_amount / conversion_factor;
            calculated_wrapped_amount = canonical_amount * conversion_factor;
        }

        // Burn tokens from users canonical supply
        let cpi_accounts = Burn {
            to: ctx
                .accounts
                .source_canonical_token_account
                .to_account_info(),
            mint: ctx.accounts.canonical_mint.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::burn(cpi_ctx, canonical_amount)?;

        // Transfer wrapped tokens from program account to user account
        let cpi_accounts = Transfer {
            from: ctx.accounts.wrapped_token_account.to_account_info(),
            to: ctx
                .accounts
                .destination_wrapped_token_account
                .to_account_info(),
            authority: ctx.accounts.pda_wrapped_token_authority.to_account_info(),
        };

        let authority_seeds = &[
            WRAPPED_TOKEN_OWNER_AUTHORITY_PDA_SEED,
            ctx.accounts.canonical_data.mint.as_ref(),
            ctx.accounts.wrapped_data.mint.as_ref(),
            &[wrapped_token_account_authority_bump],
        ];
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(
            cpi_ctx.with_signer(&[authority_seeds]),
            calculated_wrapped_amount,
        )?;

        Ok(())
    }

    /// Pause wrapped token to disallow any swaps in case of a bridge exploit
    pub fn pause_wrapped_token(ctx: Context<PauseWrappedToken>) -> ProgramResult {
        let wrapped_data = &mut ctx.accounts.wrapped_data;
        wrapped_data.paused = true;

        Ok(())
    }

    /// Unpause wrapped token to resume allowing swaps
    pub fn unpause_wrapped_token(ctx: Context<UnpauseWrappedToken>) -> ProgramResult {
        let wrapped_data = &mut ctx.accounts.wrapped_data;
        wrapped_data.paused = false;

        Ok(())
    }

    /// Set authority for adding wrapped token for given canonical token
    pub fn set_canonical_swap_authority(ctx: Context<SetCanonicalSwapAuthority>) -> ProgramResult {
        let canonical_data = &mut ctx.accounts.canonical_data;
        canonical_data.authority = *ctx.accounts.new_authority.key;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(canonical_mint_authority_bump: u8)]
pub struct InitializeCanonicalToken<'info> {
    // must have minting authority for canonical token
    pub initializer: Signer<'info>,

    // Canonical spl-token mint account
    // THE MINT AUTHORITY WILL BE TRANSFERRED FROM
    // `initializer` TO `canonical_mint_authority` PDA
    #[account(mut)]
    pub canonical_mint: Account<'info, Mint>,

    // Mint authority holding PDA
    #[account(
        seeds = [
            CANONICAL_MINT_AUTHORITY_PDA_SEED.as_ref(),
            canonical_mint.to_account_info().key.as_ref()
        ],
        bump = canonical_mint_authority_bump,
    )]
    pub pda_canonical_mint_authority: AccountInfo<'info>,

    // Data account holding information about the
    // canonical token
    #[account(zero)]
    pub canonical_data: Account<'info, CanonicalData>,

    #[account(address = token::ID)]
    pub token_program: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(wrapped_token_account_bump: u8, wrapped_token_account_authority_bump: u8)]
pub struct InitializeWrappedToken<'info> {
    #[account(mut)]
    pub current_authority: Signer<'info>,
    pub wrapped_token_mint: Account<'info, Mint>,

    // Wrapped token holding PDA
    // THE OWNER AUTHORITY WILL BE TRANSFERRED FROM
    // `initializer` TO `wrapped_token_account_authority` PDA
    #[account(
        init,
        seeds = [
            WRAPPED_TOKEN_ACCOUNT_PDA_SEED.as_ref(),
            canonical_data.mint.as_ref(),
            wrapped_token_mint.to_account_info().key.as_ref()
        ],
        bump = wrapped_token_account_bump,
        payer = current_authority,
        token::mint = wrapped_token_mint,
        token::authority = current_authority,
    )]
    pub pda_wrapped_token_account: Account<'info, TokenAccount>,

    // Wrapped token account owner PDA
    #[account(
        seeds = [
            WRAPPED_TOKEN_OWNER_AUTHORITY_PDA_SEED.as_ref(),
            canonical_data.mint.as_ref(),
            wrapped_token_mint.to_account_info().key.as_ref()
        ],
        bump = wrapped_token_account_authority_bump,
    )]
    pub pda_wrapped_token_account_authority: AccountInfo<'info>,

    // Data account holding information about the
    // canonical token
    #[account(
        constraint = canonical_data.authority == *current_authority.key,
        owner = *program_id,
    )]
    pub canonical_data: Account<'info, CanonicalData>,

    // Data account holding information about the
    // wrapped token
    #[account(zero)]
    pub wrapped_data: Account<'info, WrappedData>,

    #[account(address = token::ID)]
    pub token_program: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(canonical_amount: u64, canonical_mint_authority_bump: u8, wrapped_token_account_bump: u8)]
pub struct SwapWrappedForCanonical<'info> {
    // Any end user wanting to swap tokens
    pub user: Signer<'info>,

    // Token account for resulting canonical tokens
    #[account(mut)]
    pub destination_canonical_token_account: Account<'info, TokenAccount>,

    // Canonical mint account
    #[account(mut)]
    pub canonical_mint: Account<'info, Mint>,

    // Wrapped token mint account
    pub wrapped_token_mint: Account<'info, Mint>,

    // PDA having  mint authority
    #[account(
        seeds = [
            CANONICAL_MINT_AUTHORITY_PDA_SEED.as_ref(),
            canonical_mint.to_account_info().key.as_ref()
        ],
        bump = canonical_mint_authority_bump,
    )]
    pub pda_canonical_mint_authority: AccountInfo<'info>,

    // The user owned token account transfer wrapped tokens from
    #[account(mut)]
    pub source_wrapped_token_account: Account<'info, TokenAccount>,

    // The PDA token account to transfer wrapped tokens to
    #[account(
        mut,
        seeds = [
            WRAPPED_TOKEN_ACCOUNT_PDA_SEED.as_ref(),
            canonical_data.mint.as_ref(),
            wrapped_token_mint.to_account_info().key.as_ref()
        ],
        bump = wrapped_token_account_bump,
    )]
    pub wrapped_token_account: Account<'info, TokenAccount>,

    #[account(
        constraint = canonical_data.mint == *canonical_mint.to_account_info().key,
        owner = *program_id,
    )]
    pub canonical_data: Account<'info, CanonicalData>,

    #[account(
        has_one = canonical_data,
        constraint = wrapped_data.mint == source_wrapped_token_account.mint,
        constraint = wrapped_data.paused == false,
        owner = *program_id,
    )]
    pub wrapped_data: Account<'info, WrappedData>,

    #[account(address = token::ID)]
    pub token_program: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(wrapped_amount: u64, wrapped_token_account_authority_bump: u8)]
pub struct SwapCanonicalForWrapped<'info> {
    // any signer
    pub user: Signer<'info>,

    // Token account for resulting canonical tokens
    #[account(mut)]
    pub source_canonical_token_account: Account<'info, TokenAccount>,

    // Canonical mint account
    #[account(mut)]
    pub canonical_mint: Account<'info, Mint>,

    // The user owned token account to transfer wrapped tokens to
    #[account(mut)]
    pub destination_wrapped_token_account: Account<'info, TokenAccount>,

    // The PDA token account to transfer wrapped tokens from
    #[account(mut)]
    pub wrapped_token_account: Account<'info, TokenAccount>,

    // PDA owning the wrapped token account
    #[account(
        seeds = [
            WRAPPED_TOKEN_OWNER_AUTHORITY_PDA_SEED.as_ref(),
            canonical_data.mint.as_ref(),
            wrapped_data.mint.as_ref()
        ],
        bump = wrapped_token_account_authority_bump,
    )]
    pub pda_wrapped_token_authority: AccountInfo<'info>,

    #[account(
        constraint = canonical_data.mint == *canonical_mint.to_account_info().key,
        owner = *program_id,
    )]
    pub canonical_data: Account<'info, CanonicalData>,

    #[account(
        has_one = canonical_data,
        constraint = wrapped_data.mint == destination_wrapped_token_account.mint,
        constraint = wrapped_data.paused == false,
        owner = *program_id,
    )]
    pub wrapped_data: Account<'info, WrappedData>,

    #[account(address = token::ID)]
    pub token_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct PauseWrappedToken<'info> {
    // must equal `canonical_data.authority`
    pub current_authority: Signer<'info>,

    #[account(
        constraint = canonical_data.authority == *current_authority.key,
    )]
    pub canonical_data: Account<'info, CanonicalData>,

    #[account(
        mut,
        has_one = canonical_data,
        constraint = wrapped_data.paused == false,
        owner = *program_id,
    )]
    pub wrapped_data: Account<'info, WrappedData>,
}

#[derive(Accounts)]
pub struct UnpauseWrappedToken<'info> {
    // must equal `canonical_data.authority`
    pub current_authority: Signer<'info>,

    #[account(
        constraint = canonical_data.authority == *current_authority.key,
    )]
    pub canonical_data: Account<'info, CanonicalData>,

    #[account(
        mut,
        has_one = canonical_data,
        constraint = wrapped_data.paused == true,
        owner = *program_id,
    )]
    pub wrapped_data: Account<'info, WrappedData>,
}

#[derive(Accounts)]
pub struct SetCanonicalSwapAuthority<'info> {
    // Current authority, must by equal to `canonical_data.authority`
    pub current_authority: Signer<'info>,

    // New authority to set `canonical_data.authority` to
    pub new_authority: AccountInfo<'info>,

    // Data account holding information about the
    // canonical token will be closed and rent returned
    // to initializer after execution
    #[account(
        mut,
        constraint = canonical_data.authority == *current_authority.key,
        owner = *program_id,
    )]
    pub canonical_data: Account<'info, CanonicalData>,
}

#[account]
pub struct CanonicalData {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub decimals: u8,
}

#[account]
pub struct WrappedData {
    pub canonical_data: Pubkey,
    pub mint: Pubkey,
    pub decimals: u8,
    pub paused: bool,
}
