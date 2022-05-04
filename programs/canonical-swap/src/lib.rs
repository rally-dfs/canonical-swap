use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, MintTo, SetAuthority, Token, TokenAccount, Transfer};
use spl_token::instruction::AuthorityType;
declare_id!("CSwAp3hdedZJBmhWMjv8BJ7anTLMQ2hBqKdnXV5bB3Nz");

const CANONICAL_MINT_AUTHORITY_PDA_SEED: &[u8] = b"can_mint_authority";
const WRAPPED_TOKEN_ACCOUNT_PDA_SEED: &[u8] = b"token_account_seed";
const WRAPPED_TOKEN_OWNER_AUTHORITY_PDA_SEED: &[u8] = b"wrapped_acct_authority";

#[program]
mod canonical_swap {
    use super::*;

    /// Initialize a canonical token and transfer mint authority over to a PDA
    pub fn initialize_canonical_token(ctx: Context<InitializeCanonicalToken>) -> Result<()> {
        // Set canonical token data
        let canonical_data = &mut ctx.accounts.canonical_data;
        canonical_data.authority = *ctx.accounts.initializer.key;
        canonical_data.mint = *ctx.accounts.canonical_mint.to_account_info().key;
        canonical_data.decimals = ctx.accounts.canonical_mint.decimals;
        canonical_data.canonical_mint_authority_bump =
            *ctx.bumps.get("pda_canonical_mint_authority").unwrap();

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
    pub fn initialize_wrapped_token(ctx: Context<InitializeWrappedToken>) -> Result<()> {
        // Set wrapped token data
        let wrapped_data = &mut ctx.accounts.wrapped_data;

        wrapped_data.canonical_data = *ctx.accounts.canonical_data.to_account_info().key;
        wrapped_data.mint = *ctx.accounts.wrapped_token_mint.to_account_info().key;
        wrapped_data.decimals = ctx.accounts.wrapped_token_mint.decimals;
        wrapped_data.wrapped_token_account_authority_bump = *ctx
            .bumps
            .get("pda_wrapped_token_account_authority")
            .unwrap();
        wrapped_data.swap_canonical_for_wrapped_enabled = true;
        wrapped_data.swap_wrapped_for_canonical_enabled = true;

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
    ) -> Result<()> {
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
            &[ctx.accounts.canonical_data.canonical_mint_authority_bump],
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
    ) -> Result<()> {
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
            from: ctx
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
            &[ctx
                .accounts
                .wrapped_data
                .wrapped_token_account_authority_bump],
        ];
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(
            cpi_ctx.with_signer(&[authority_seeds]),
            calculated_wrapped_amount,
        )?;

        Ok(())
    }

    /// Enable wrapped token to allow a specific swap direction
    pub fn enable_wrapped_token(
        ctx: Context<EnableWrappedToken>,
        direction_swap_wrapped: bool,
    ) -> Result<()> {
        let wrapped_data = &mut ctx.accounts.wrapped_data;
        if direction_swap_wrapped {
            wrapped_data.swap_wrapped_for_canonical_enabled = true;
        } else {
            wrapped_data.swap_canonical_for_wrapped_enabled = true;
        }

        Ok(())
    }

    /// Disable wrapped token to disallow a specific swap direction
    pub fn disable_wrapped_token(
        ctx: Context<DisableWrappedToken>,
        direction_swap_wrapped: bool,
    ) -> Result<()> {
        let wrapped_data = &mut ctx.accounts.wrapped_data;
        if direction_swap_wrapped {
            wrapped_data.swap_wrapped_for_canonical_enabled = false;
        } else {
            wrapped_data.swap_canonical_for_wrapped_enabled = false;
        }

        Ok(())
    }

    /// Set authority for adding wrapped token for given canonical token
    pub fn set_canonical_swap_authority(ctx: Context<SetCanonicalSwapAuthority>) -> Result<()> {
        let canonical_data = &mut ctx.accounts.canonical_data;
        canonical_data.authority = *ctx.accounts.new_authority.key;

        Ok(())
    }
}

#[derive(Accounts)]
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
        bump,
    )]
    /// CHECK: seeds are checked
    pub pda_canonical_mint_authority: UncheckedAccount<'info>,

    // Data account holding information about the
    // canonical token
    #[account(zero)]
    pub canonical_data: Account<'info, CanonicalData>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
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
        bump,
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
        bump,
    )]
    /// CHECK: seeds are checked
    pub pda_wrapped_token_account_authority: UncheckedAccount<'info>,

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

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(canonical_amount: u64)]
pub struct SwapWrappedForCanonical<'info> {
    // Any end user wanting to swap tokens
    pub user: Signer<'info>,

    // Token account for resulting mint of canonical tokens
    #[account(mut)]
    pub destination_canonical_token_account: Box<Account<'info, TokenAccount>>,

    // Canonical mint account
    #[account(mut)]
    pub canonical_mint: Box<Account<'info, Mint>>,

    // PDA having  mint authority
    #[account(
        seeds = [
            CANONICAL_MINT_AUTHORITY_PDA_SEED.as_ref(),
            canonical_mint.to_account_info().key.as_ref()
        ],
        bump,
    )]
    /// CHECK: seeds are checked
    pub pda_canonical_mint_authority: UncheckedAccount<'info>,

    // The user owned token account transfer wrapped tokens from
    #[account(mut)]
    pub source_wrapped_token_account: Box<Account<'info, TokenAccount>>,

    // The PDA token account to transfer wrapped tokens to
    #[account(
        mut,
        seeds = [
            WRAPPED_TOKEN_ACCOUNT_PDA_SEED.as_ref(),
            canonical_data.mint.as_ref(),
            wrapped_data.mint.as_ref(),
        ],
        bump,
    )]
    pub wrapped_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        constraint = canonical_data.mint == *canonical_mint.to_account_info().key,
        constraint = canonical_data.mint == destination_canonical_token_account.mint,
        owner = *program_id,
    )]
    pub canonical_data: Account<'info, CanonicalData>,

    #[account(
        has_one = canonical_data,
        constraint = wrapped_data.mint == source_wrapped_token_account.mint,
        constraint = wrapped_data.mint == wrapped_token_account.mint,
        constraint = wrapped_data.swap_wrapped_for_canonical_enabled == true,
        owner = *program_id,
    )]
    pub wrapped_data: Account<'info, WrappedData>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(wrapped_amount: u64)]
pub struct SwapCanonicalForWrapped<'info> {
    // any signer
    pub user: Signer<'info>,

    // Source token account to burn canonical tokens from
    #[account(mut)]
    pub source_canonical_token_account: Box<Account<'info, TokenAccount>>,

    // Canonical mint account
    #[account(mut)]
    pub canonical_mint: Box<Account<'info, Mint>>,

    // The user owned token account to transfer wrapped tokens to
    #[account(mut)]
    pub destination_wrapped_token_account: Box<Account<'info, TokenAccount>>,

    // The PDA token account to transfer wrapped tokens from
    #[account(
        mut,
        seeds = [
            WRAPPED_TOKEN_ACCOUNT_PDA_SEED.as_ref(),
            canonical_data.mint.as_ref(),
            wrapped_data.mint.as_ref(),
        ],
        bump,
    )]
    pub wrapped_token_account: Box<Account<'info, TokenAccount>>,

    // PDA owning the wrapped token account
    #[account(
        seeds = [
            WRAPPED_TOKEN_OWNER_AUTHORITY_PDA_SEED.as_ref(),
            canonical_data.mint.as_ref(),
            wrapped_data.mint.as_ref()
        ],
        bump,
    )]
    /// CHECK: seeds are checked
    pub pda_wrapped_token_authority: UncheckedAccount<'info>,

    #[account(
        constraint = canonical_data.mint == *canonical_mint.to_account_info().key,
        constraint = canonical_data.mint == source_canonical_token_account.mint,
        owner = *program_id,
    )]
    pub canonical_data: Account<'info, CanonicalData>,

    #[account(
        has_one = canonical_data,
        constraint = wrapped_data.mint == wrapped_token_account.mint,
        constraint = wrapped_data.mint == destination_wrapped_token_account.mint,
        constraint = wrapped_data.swap_canonical_for_wrapped_enabled == true,
        owner = *program_id,
    )]
    pub wrapped_data: Account<'info, WrappedData>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(direction_swap_wrapped: bool)]
pub struct EnableWrappedToken<'info> {
    // must equal `canonical_data.authority`
    pub current_authority: Signer<'info>,

    #[account(
        constraint = canonical_data.authority == *current_authority.key,
        owner = *program_id,
    )]
    pub canonical_data: Account<'info, CanonicalData>,

    #[account(
        mut,
        has_one = canonical_data,
        owner = *program_id,
    )]
    pub wrapped_data: Account<'info, WrappedData>,
}

#[derive(Accounts)]
#[instruction(direction_swap_wrapped: bool)]
pub struct DisableWrappedToken<'info> {
    // must equal `canonical_data.authority`
    pub current_authority: Signer<'info>,

    #[account(
        constraint = canonical_data.authority == *current_authority.key,
        owner = *program_id,
    )]
    pub canonical_data: Account<'info, CanonicalData>,

    #[account(
        mut,
        has_one = canonical_data,
        owner = *program_id,
    )]
    pub wrapped_data: Account<'info, WrappedData>,
}

#[derive(Accounts)]
pub struct SetCanonicalSwapAuthority<'info> {
    // Current authority, must by equal to `canonical_data.authority`
    pub current_authority: Signer<'info>,

    // New authority to set `canonical_data.authority` to
    /// CHECK: new authority can be any account
    pub new_authority: UncheckedAccount<'info>,

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
    pub canonical_mint_authority_bump: u8,
}

#[account]
pub struct WrappedData {
    pub canonical_data: Pubkey,
    pub mint: Pubkey,
    pub decimals: u8,
    pub wrapped_token_account_authority_bump: u8,
    pub swap_wrapped_for_canonical_enabled: bool,
    pub swap_canonical_for_wrapped_enabled: bool,
}
