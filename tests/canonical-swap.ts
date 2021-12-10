import chai from "chai";
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
        [CANONICAL_MINT_AUTHORITY_PDA_SEED, canonicalMint.publicKey.toBuffer()],
        canSwap.programId
      );

    await canSwap.rpc.initializeCanonicalToken(expectedMintAuthorityBump, {
      accounts: {
        initializer: canonicalAuthority.publicKey,
        canonicalMint: canonicalMint.publicKey,
        pdaCanonicalMintAuthority: expectedMintAuthorityPDA,
        canonicalData: canonicalData.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      },
      instructions: [
        await canSwap.account.canonicalData.createInstruction(
          canonicalData,
          8 + 65
        ),
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
        [
          TOKEN_ACCOUNT_SEED,
          canonicalMint.publicKey.toBuffer(),
          wrappedMint.publicKey.toBuffer(),
        ],
        canSwap.programId
      );

    [wrappedTokenAccountAuthority, wrappedTokenAccountAuthorityBump] =
      await PublicKey.findProgramAddress(
        [
          WRAPPED_TOKEN_OWNER_AUTHORITY_PDA_SEED,
          canonicalMint.publicKey.toBuffer(),
          wrappedMint.publicKey.toBuffer(),
        ],
        canSwap.programId
      );

    await canSwap.rpc.initializeWrappedToken(
      wrappedTokenAccountBump,
      wrappedTokenAccountAuthorityBump,
      {
        accounts: {
          currentAuthority: canonicalAuthority.publicKey,
          wrappedTokenMint: wrappedMint.publicKey,
          pdaWrappedTokenAccount: wrappedTokenAccount,
          pdaWrappedTokenAccountAuthority: wrappedTokenAccountAuthority,
          canonicalData: canonicalData.publicKey,
          wrappedData: wrappedData.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          systemProgram: SystemProgram.programId,
        },
        instructions: [
          await canSwap.account.wrappedData.createInstruction(
            wrappedData,
            8 + 66
          ),
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

      expect(postTxCanonicalData.authority.toString()).to.eq(
        canonicalAuthority.publicKey.toString()
      );

      expect(postTxCanonicalData.mint.toString()).to.eq(
        canonicalMint.publicKey.toString()
      );

      expect(postTxCanonicalData.decimals).to.eq(canonicalDecimals);

      const mintInfo = await canonicalMint.getMintInfo();
      expect(mintInfo.mintAuthority.toString()).to.eq(
        expectedMintAuthorityPDA.toString()
      );

      const dataAcctSolBalance = await provider.connection.getBalance(
        canonicalData.publicKey
      );

      expect(dataAcctSolBalance).to.be.greaterThan(0);

      const dataAcctInfo = await provider.connection.getAccountInfo(
        canonicalData.publicKey
      );

      expect(dataAcctInfo.owner.toString()).to.eq(canSwap.programId.toString());
    });
  });

  describe("#initializeWrappedToken", () => {
    it("Make sure initialized wrapped token has set proper account data", async () => {
      const postTxWrappedData = await canSwap.account.wrappedData.fetch(
        wrappedData.publicKey
      );

      expect(postTxWrappedData.canonicalData.toString()).to.eq(
        canonicalData.publicKey.toString()
      );

      expect(postTxWrappedData.mint.toString()).to.eq(
        wrappedMint.publicKey.toString()
      );

      expect(postTxWrappedData.decimals).to.eq(wrappedDecimals);
      expect(postTxWrappedData.paused).to.be.false;

      const accountInfo = await wrappedMint.getAccountInfo(wrappedTokenAccount);

      expect(accountInfo.owner.toString()).to.eq(
        wrappedTokenAccountAuthority.toString()
      );

      const dataAcctSolBalance = await provider.connection.getBalance(
        wrappedData.publicKey
      );

      expect(dataAcctSolBalance).to.be.greaterThan(0);

      const dataAcctInfo = await provider.connection.getAccountInfo(
        wrappedData.publicKey
      );

      expect(dataAcctInfo.owner.toString()).to.eq(canSwap.programId.toString());
    });
  });

  describe("#pausing", () => {
    it("pauses the wrapped token", async () => {
      const preTxWrappedData = await canSwap.account.wrappedData.fetch(
        wrappedData.publicKey
      );
      expect(preTxWrappedData.paused).to.be.false;

      await canSwap.rpc.pauseWrappedToken({
        accounts: {
          currentAuthority: canonicalAuthority.publicKey,
          canonicalData: canonicalData.publicKey,
          wrappedData: wrappedData.publicKey,
        },
        signers: [canonicalAuthority],
      });

      const postTxWrappedData = await canSwap.account.wrappedData.fetch(
        wrappedData.publicKey
      );

      expect(postTxWrappedData.paused).to.be.true;
    });

    it("fails swap when paused", async () => {
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

      const failedSwap = canSwap.rpc.swapWrappedForCanonical(
        destinationAmount,
        expectedMintAuthorityBump,
        {
          accounts: {
            user: wallet.publicKey,
            destinationCanonicalTokenAccount: destinationTokenAccount,
            canonicalMint: canonicalMint.publicKey,
            pdaCanonicalMintAuthority: expectedMintAuthorityPDA,
            sourceWrappedTokenAccount: sourceTokenAccount,
            wrappedTokenAccount,
            canonicalData: canonicalData.publicKey,
            wrappedData: wrappedData.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          },
          signers: [wallet.payer],
        }
      );

      await expect(failedSwap).to.eventually.be.rejectedWith(
        "143: A raw constraint was violated"
      );
    });

    it("unpauses the wrapped token", async () => {
      const preTxWrappedData = await canSwap.account.wrappedData.fetch(
        wrappedData.publicKey
      );
      expect(preTxWrappedData.paused).to.be.true;

      await canSwap.rpc.unpauseWrappedToken({
        accounts: {
          currentAuthority: canonicalAuthority.publicKey,
          canonicalData: canonicalData.publicKey,
          wrappedData: wrappedData.publicKey,
        },
        signers: [canonicalAuthority],
      });

      const postTxWrappedData = await canSwap.account.wrappedData.fetch(
        wrappedData.publicKey
      );

      expect(postTxWrappedData.paused).to.be.false;
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
      expect(preTxDestinationTokenAccount.amount.toNumber()).to.eq(0);

      const preTxSourceTokenAccount = await wrappedMint.getAccountInfo(
        sourceTokenAccount
      );

      expect(preTxSourceTokenAccount.amount.toNumber()).to.eq(sourceAmount);

      await canSwap.rpc.swapWrappedForCanonical(
        destinationAmount,
        expectedMintAuthorityBump,
        {
          accounts: {
            user: wallet.publicKey,
            destinationCanonicalTokenAccount: destinationTokenAccount,
            canonicalMint: canonicalMint.publicKey,
            pdaCanonicalMintAuthority: expectedMintAuthorityPDA,
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
      expect(postTxDestinationTokenAccount.amount.toNumber()).to.eq(
        destinationAmount.toNumber()
      );

      const postTxSourceTokenAccount = await wrappedMint.getAccountInfo(
        sourceTokenAccount
      );
      expect(postTxSourceTokenAccount.amount.toNumber()).to.eq(0);
    });

    it("ensures rounding doesn't benefit the user", async () => {
      const destinationTokenAccount = await canonicalMint.createAccount(
        wallet.publicKey
      );

      const sourceTokenAccount = await wrappedMint.createAccount(
        wallet.publicKey
      );

      const destinationAmount = new BN(1);

      const preTxDestinationTokenAccount = await canonicalMint.getAccountInfo(
        destinationTokenAccount
      );

      expect(preTxDestinationTokenAccount.amount.toNumber()).to.eq(0);

      await canSwap.rpc.swapWrappedForCanonical(
        destinationAmount,
        expectedMintAuthorityBump,
        {
          accounts: {
            user: wallet.publicKey,
            destinationCanonicalTokenAccount: destinationTokenAccount,
            canonicalMint: canonicalMint.publicKey,
            pdaCanonicalMintAuthority: expectedMintAuthorityPDA,
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
      expect(postTxDestinationTokenAccount.amount.toNumber()).to.eq(0);

      const postTxSourceTokenAccount = await wrappedMint.getAccountInfo(
        sourceTokenAccount
      );
      expect(postTxSourceTokenAccount.amount.toNumber()).to.eq(0);
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

      expect(preTxDestinationTokenAccount.amount.toNumber()).to.eq(0);

      const preTxSourceTokenAccount = await canonicalMint.getAccountInfo(
        sourceTokenAccount
      );

      expect(preTxSourceTokenAccount.amount.toNumber()).to.eq(sourceAmount);

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
            pdaWrappedTokenAuthority: wrappedTokenAccountAuthority,
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
      expect(postTxDestinationTokenAccount.amount.toNumber()).to.eq(
        destinationAmount.toNumber()
      );

      const postTxSourceTokenAccount = await canonicalMint.getAccountInfo(
        sourceTokenAccount
      );
      expect(postTxSourceTokenAccount.amount.toNumber()).to.eq(0);
    });
  });

  describe("#set_canonical_swap_authority", () => {
    it("Sets new authority for given canonical swap data", async () => {
      const preTxCanonicalData = await canSwap.account.canonicalData.fetch(
        canonicalData.publicKey
      );
      expect(preTxCanonicalData.authority.toString()).to.eq(
        canonicalAuthority.publicKey.toString()
      );

      const newAuthority = Keypair.generate();

      await canSwap.rpc.setCanonicalSwapAuthority({
        accounts: {
          currentAuthority: canonicalAuthority.publicKey,
          newAuthority: newAuthority.publicKey,
          canonicalData: canonicalData.publicKey,
        },
        signers: [canonicalAuthority],
      });

      const postTxCanonicalData = await canSwap.account.canonicalData.fetch(
        canonicalData.publicKey
      );

      expect(postTxCanonicalData.authority.toString()).to.eq(
        newAuthority.publicKey.toString()
      );

      // set back to original
      await canSwap.rpc.setCanonicalSwapAuthority({
        accounts: {
          currentAuthority: newAuthority.publicKey,
          newAuthority: canonicalAuthority.publicKey,
          canonicalData: canonicalData.publicKey,
        },
        signers: [newAuthority],
      });
    });
  });
});
