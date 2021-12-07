import chai, { assert } from "chai";
import chaiAsPromised from "chai-as-promised";
import * as anchor from "@project-serum/anchor";
import { BN, Program, Provider } from "@project-serum/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { CanonicalSwap } from "../target/types/canonical_swap";

chai.use(chaiAsPromised);

const { expect } = chai;

const CANONICAL_MINT_AUTHORITY_PDA_SEED = Buffer.from(
  anchor.utils.bytes.utf8.encode("can_mint_authority")
);

const WRAPPED_TOKEN_OWNER_AUTHORITY_PDA_SEED = Buffer.from(
  anchor.utils.bytes.utf8.encode("wrapped_acct_authority")
);

const TOKEN_ACCOUNT_SEED = Buffer.from(
  anchor.utils.bytes.utf8.encode("token_account_seed")
);

describe("canonical-swap", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.Provider.env();
  anchor.setProvider(provider);
  const wallet = provider.wallet as anchor.Wallet;
  const canSwap = anchor.workspace.CanonicalSwap as Program<CanonicalSwap>;

  const canonicalAuthority = Keypair.generate();
  const canonicalData = Keypair.generate();
  const canonicalDecimals = 9;

  let canonicalMint: Token;
  let tokenDistributorTokenAccount: PublicKey;
  let expectedMintAuthorityPDA: PublicKey;
  let expectedMintAuthorityBump: number;

  const wrappedDecimals = 8;
  const wrappedData = Keypair.generate();
  let wrappedMint: Token;
  let wrappedTokenAccount: PublicKey;
  let wrappedTokenAccountBump: number;
  let wrappedTokenAccountAuthority: PublicKey;
  let wrappedTokenAccountAuthorityBump: number;

  before("Sets up accounts, canonical token and canonical mint", async () => {
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        wallet.payer.publicKey,
        10000000000
      ),
      "confirmed"
    );

    await provider.send(
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

    canonicalMint = await Token.createMint(
      provider.connection,
      wallet.payer,
      canonicalAuthority.publicKey,
      null,
      canonicalDecimals,
      TOKEN_PROGRAM_ID
    );

    tokenDistributorTokenAccount = await canonicalMint.createAccount(
      wallet.publicKey
    );

    await canonicalMint.mintTo(
      tokenDistributorTokenAccount,
      canonicalAuthority.publicKey,
      [canonicalAuthority],
      1000000000
    );

    [expectedMintAuthorityPDA, expectedMintAuthorityBump] =
      await PublicKey.findProgramAddress(
        [CANONICAL_MINT_AUTHORITY_PDA_SEED],
        canSwap.programId
      );

    await canSwap.rpc.initializeCanonicalToken(expectedMintAuthorityBump, {
      accounts: {
        initializer: canonicalAuthority.publicKey,
        canonicalMint: canonicalMint.publicKey,
        canonicalMintAuthority: expectedMintAuthorityPDA,
        canonicalData: canonicalData.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      },
      instructions: [
        await canSwap.account.canonicalData.createInstruction(canonicalData),
      ],
      signers: [canonicalData, canonicalAuthority],
    });

    wrappedMint = await Token.createMint(
      provider.connection,
      wallet.payer,
      canonicalAuthority.publicKey,
      null,
      wrappedDecimals,
      TOKEN_PROGRAM_ID
    );

    [wrappedTokenAccount, wrappedTokenAccountBump] =
      await PublicKey.findProgramAddress(
        [TOKEN_ACCOUNT_SEED],
        canSwap.programId
      );

    [wrappedTokenAccountAuthority, wrappedTokenAccountAuthorityBump] =
      await PublicKey.findProgramAddress(
        [WRAPPED_TOKEN_OWNER_AUTHORITY_PDA_SEED],
        canSwap.programId
      );

    await canSwap.rpc.initializeWrappedToken(
      wrappedTokenAccountBump,
      wrappedTokenAccountAuthorityBump,
      {
        accounts: {
          initializer: canonicalAuthority.publicKey,
          wrappedTokenMint: wrappedMint.publicKey,
          wrappedTokenAccount,
          wrappedTokenAccountAuthority,
          canonicalData: canonicalData.publicKey,
          wrappedData: wrappedData.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          systemProgram: SystemProgram.programId,
        },
        instructions: [
          await canSwap.account.wrappedData.createInstruction(wrappedData),
        ],
        signers: [wrappedData, canonicalAuthority],
      }
    );
  });

  describe("#initializeCanonicalToken", () => {
    it("Make sure initialized canonical token has set proper account data", async () => {
      const postTxCanonicalData = await canSwap.account.canonicalData.fetch(
        canonicalData.publicKey
      );

      assert.ok(
        postTxCanonicalData.initializer.equals(canonicalAuthority.publicKey)
      );
      assert.ok(postTxCanonicalData.mint.equals(canonicalMint.publicKey));
      assert.ok(postTxCanonicalData.decimals === canonicalDecimals);

      const mintInfo = await canonicalMint.getMintInfo();
      assert.ok(mintInfo.mintAuthority.equals(expectedMintAuthorityPDA));
    });
  });

  describe("#initializeWrappedToken", () => {
    it("Make sure initialized wrapped token has set proper account data", async () => {
      const postTxWrappedData = await canSwap.account.wrappedData.fetch(
        wrappedData.publicKey
      );

      assert.ok(
        postTxWrappedData.canonicalData.equals(canonicalData.publicKey)
      );
      assert.ok(postTxWrappedData.mint.equals(wrappedMint.publicKey));
      assert.ok(postTxWrappedData.decimals === wrappedDecimals);

      const accountInfo = await wrappedMint.getAccountInfo(wrappedTokenAccount);
      const [wrappedPdaAuthority, _bump] = await PublicKey.findProgramAddress(
        [WRAPPED_TOKEN_OWNER_AUTHORITY_PDA_SEED],
        canSwap.programId
      );

      assert.ok(accountInfo.owner.equals(wrappedPdaAuthority));
    });
  });

  describe("#swap_wrapped_for_canonical", () => {
    it("takes wrapped from source and mints canonical into destination", async () => {
      const destinationTokenAccount = await canonicalMint.createAccount(
        wallet.publicKey
      );

      const sourceTokenAccount = await wrappedMint.createAccount(
        wallet.publicKey
      );

      const destinationAmount = new BN(100);
      const sourceAmount = destinationAmount.toNumber() / 10;

      await wrappedMint.mintTo(
        sourceTokenAccount,
        canonicalAuthority.publicKey,
        [canonicalAuthority],
        sourceAmount
      );

      const preTxDestinationTokenAccount = await canonicalMint.getAccountInfo(
        destinationTokenAccount
      );
      assert.ok(preTxDestinationTokenAccount.amount.eq(new BN(0)));

      const preTxSourceTokenAccount = await wrappedMint.getAccountInfo(
        sourceTokenAccount
      );
      assert.ok(preTxSourceTokenAccount.amount.eq(new BN(sourceAmount)));

      await canSwap.rpc.swapWrappedForCanonical(
        destinationAmount,
        expectedMintAuthorityBump,
        {
          accounts: {
            user: wallet.publicKey,
            destinationCanonicalTokenAccount: destinationTokenAccount,
            canonicalMint: canonicalMint.publicKey,
            canonicalMintAuthority: expectedMintAuthorityPDA,
            sourceWrappedTokenAccount: sourceTokenAccount,
            wrappedTokenAccount,
            canonicalData: canonicalData.publicKey,
            wrappedData: wrappedData.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          },
          signers: [wallet.payer],
        }
      );

      const postTxDestinationTokenAccount = await canonicalMint.getAccountInfo(
        destinationTokenAccount
      );
      assert.ok(postTxDestinationTokenAccount.amount.eq(destinationAmount));

      const postTxSourceTokenAccount = await wrappedMint.getAccountInfo(
        sourceTokenAccount
      );
      assert.ok(postTxSourceTokenAccount.amount.eq(new BN(0)));
    });
  });

  describe("#swap_canonical_for_wrapped", () => {
    it("burns canonical from source and transfers wrapped into destination", async () => {
      const sourceTokenAccount = await canonicalMint.createAccount(
        wallet.publicKey
      );

      const destinationTokenAccount = await wrappedMint.createAccount(
        wallet.publicKey
      );

      const destinationAmount = new BN(10);
      const sourceAmount = destinationAmount.toNumber() * 10;

      await canonicalMint.transfer(
        tokenDistributorTokenAccount,
        sourceTokenAccount,
        wallet.publicKey,
        [wallet.payer],
        sourceAmount
      );

      const preTxDestinationTokenAccount = await wrappedMint.getAccountInfo(
        destinationTokenAccount
      );
      assert.ok(preTxDestinationTokenAccount.amount.eq(new BN(0)));

      const preTxSourceTokenAccount = await canonicalMint.getAccountInfo(
        sourceTokenAccount
      );

      assert.ok(preTxSourceTokenAccount.amount.eq(new BN(sourceAmount)));

      await canSwap.rpc.swapCanonicalForWrapped(
        destinationAmount,
        wrappedTokenAccountAuthorityBump,
        {
          accounts: {
            user: wallet.publicKey,
            sourceCanonicalTokenAccount: sourceTokenAccount,
            canonicalMint: canonicalMint.publicKey,
            destinationWrappedTokenAccount: destinationTokenAccount,
            wrappedTokenAccount,
            wrappedTokenAuthority: wrappedTokenAccountAuthority,
            canonicalData: canonicalData.publicKey,
            wrappedData: wrappedData.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          },
          signers: [wallet.payer],
        }
      );

      const postTxDestinationTokenAccount = await wrappedMint.getAccountInfo(
        destinationTokenAccount
      );
      assert.ok(postTxDestinationTokenAccount.amount.eq(destinationAmount));

      const postTxSourceTokenAccount = await canonicalMint.getAccountInfo(
        sourceTokenAccount
      );
      assert.ok(postTxSourceTokenAccount.amount.eq(new BN(0)));
    });
  });

  describe("#return_canonical_token_mint_authority", () => {
    it("returns the mint authority to the original initializer", async () => {
      const preMintInfo = await canonicalMint.getMintInfo();
      expect(preMintInfo.mintAuthority.toString()).to.eq(
        expectedMintAuthorityPDA.toString()
      );

      await canSwap.rpc.returnCanonicalTokenMintAuthority(
        expectedMintAuthorityBump,
        {
          accounts: {
            initializer: canonicalAuthority.publicKey,
            canonicalMint: canonicalMint.publicKey,
            canonicalMintAuthority: expectedMintAuthorityPDA,
            canonicalData: canonicalData.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          },
          signers: [canonicalAuthority],
        }
      );

      const postMintInfo = await canonicalMint.getMintInfo();

      expect(postMintInfo.mintAuthority.toString()).to.eq(
        canonicalAuthority.publicKey.toString()
      );
    });
  });
});
