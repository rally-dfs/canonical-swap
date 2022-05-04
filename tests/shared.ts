import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { AnchorProvider, Program, utils, Wallet } from "@project-serum/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import {
  createAccount,
  createMint,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { CanonicalSwap } from "../target/types/canonical_swap";

chai.use(chaiAsPromised);

export const { expect } = chai;

export const CANONICAL_MINT_AUTHORITY_PDA_SEED = Buffer.from(
  utils.bytes.utf8.encode("can_mint_authority")
);

export const WRAPPED_TOKEN_OWNER_AUTHORITY_PDA_SEED = Buffer.from(
  utils.bytes.utf8.encode("wrapped_acct_authority")
);

export const TOKEN_ACCOUNT_SEED = Buffer.from(
  utils.bytes.utf8.encode("token_account_seed")
);

export const fixture = async (
  provider: AnchorProvider,
  wallet: Wallet,
  canSwap: Program<CanonicalSwap>
) => {
  const canonicalAuthority = Keypair.generate();
  const canonicalData = Keypair.generate();
  const wrappedData = Keypair.generate();

  const canonicalDecimals = 9;
  const wrappedDecimals = 8;

  await provider.connection.sendTransaction(
    (() => {
      const tx = new Transaction();
      tx.add(
        SystemProgram.transfer({
          fromPubkey: wallet.payer.publicKey,
          toPubkey: canonicalAuthority.publicKey,
          lamports: 1000000000,
        })
      );
      return tx;
    })(),
    [wallet.payer]
  );

  const canonicalMint = await createMint(
    provider.connection,
    wallet.payer,
    canonicalAuthority.publicKey,
    null,
    canonicalDecimals
  );

  const tokenDistributorTokenAccount = await createAccount(
    provider.connection,
    wallet.payer,
    canonicalMint,
    wallet.publicKey,
    Keypair.generate()
  );

  await mintTo(
    provider.connection,
    canonicalAuthority,
    canonicalMint,
    tokenDistributorTokenAccount,
    canonicalAuthority.publicKey,
    1000000000
  );

  const [expectedMintAuthorityPDA, mintAuthorityBump] =
    await PublicKey.findProgramAddress(
      [CANONICAL_MINT_AUTHORITY_PDA_SEED, canonicalMint.toBuffer()],
      canSwap.programId
    );

  await canSwap.methods
    .initializeCanonicalToken()
    .accounts({
      initializer: canonicalAuthority.publicKey,
      canonicalMint: canonicalMint,
      pdaCanonicalMintAuthority: expectedMintAuthorityPDA,
      canonicalData: canonicalData.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .preInstructions([
      await canSwap.account.canonicalData.createInstruction(
        canonicalData,
        8 + 66
      ),
    ])
    .signers([canonicalData, canonicalAuthority])
    .rpc();

  const wrappedMint = await createMint(
    provider.connection,
    wallet.payer,
    canonicalAuthority.publicKey,
    null,
    wrappedDecimals
  );

  const [wrappedTokenAccount] = await PublicKey.findProgramAddress(
    [TOKEN_ACCOUNT_SEED, canonicalMint.toBuffer(), wrappedMint.toBuffer()],
    canSwap.programId
  );

  const [wrappedTokenAccountAuthority, wrappedTokenAccountAuthorityBump] =
    await PublicKey.findProgramAddress(
      [
        WRAPPED_TOKEN_OWNER_AUTHORITY_PDA_SEED,
        canonicalMint.toBuffer(),
        wrappedMint.toBuffer(),
      ],
      canSwap.programId
    );

  await canSwap.methods
    .initializeWrappedToken()
    .accounts({
      currentAuthority: canonicalAuthority.publicKey,
      wrappedTokenMint: wrappedMint,
      pdaWrappedTokenAccount: wrappedTokenAccount,
      pdaWrappedTokenAccountAuthority: wrappedTokenAccountAuthority,
      canonicalData: canonicalData.publicKey,
      wrappedData: wrappedData.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
      systemProgram: SystemProgram.programId,
    })
    .preInstructions([
      await canSwap.account.wrappedData.createInstruction(wrappedData, 8 + 68),
    ])
    .signers([wrappedData, canonicalAuthority])
    .rpc();

  await mintTo(
    provider.connection,
    canonicalAuthority,
    wrappedMint,
    wrappedTokenAccount,
    canonicalAuthority.publicKey,
    1000000000
  );

  return {
    tokenDistributorTokenAccount,
    canonicalAuthority,
    canonicalData,
    wrappedData,
    canonicalDecimals,
    wrappedDecimals,
    canonicalMint,
    expectedMintAuthorityPDA,
    mintAuthorityBump,
    wrappedMint,
    wrappedTokenAccount,
    wrappedTokenAccountAuthority,
    wrappedTokenAccountAuthorityBump,
  };
};
