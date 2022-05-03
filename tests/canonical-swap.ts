import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {
  AnchorProvider,
  BN,
  Program,
  setProvider,
  utils,
  Wallet,
  workspace,
} from "@project-serum/anchor";
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
  getMint,
  getAccount,
  transfer,
} from "@solana/spl-token";
import { CanonicalSwap } from "../target/types/canonical_swap";

chai.use(chaiAsPromised);

const { expect } = chai;

const CANONICAL_MINT_AUTHORITY_PDA_SEED = Buffer.from(
  utils.bytes.utf8.encode("can_mint_authority")
);

const WRAPPED_TOKEN_OWNER_AUTHORITY_PDA_SEED = Buffer.from(
  utils.bytes.utf8.encode("wrapped_acct_authority")
);

const TOKEN_ACCOUNT_SEED = Buffer.from(
  utils.bytes.utf8.encode("token_account_seed")
);

describe("canonical-swap", () => {
  // Configure the client to use the local cluster.
  const provider = AnchorProvider.local();
  setProvider(provider);
  const wallet = provider.wallet as Wallet;

  const canSwap = workspace.CanonicalSwap as Program<CanonicalSwap>;

  const canonicalAuthority = Keypair.generate();
  const canonicalData = Keypair.generate();
  const canonicalDecimals = 9;

  let canonicalMint: PublicKey;
  let tokenDistributorTokenAccount: PublicKey;
  let expectedMintAuthorityPDA: PublicKey;
  let expectedMintAuthorityBump: number;

  const wrappedDecimals = 8;
  const wrappedData = Keypair.generate();
  let wrappedMint: PublicKey;
  let wrappedTokenAccount: PublicKey;
  let wrappedTokenAccountBump: number;
  let wrappedTokenAccountAuthority: PublicKey;
  let wrappedTokenAccountAuthorityBump: number;

  before("Sets up accounts, canonical token and canonical mint", async () => {
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

    canonicalMint = await createMint(
      provider.connection,
      wallet.payer,
      canonicalAuthority.publicKey,
      null,
      canonicalDecimals
    );

    tokenDistributorTokenAccount = await createAccount(
      provider.connection,
      wallet.payer,
      canonicalMint,
      wallet.publicKey
    );

    await mintTo(
      provider.connection,
      canonicalAuthority,
      canonicalMint,
      tokenDistributorTokenAccount,
      canonicalAuthority.publicKey,
      1000000000
    );

    [expectedMintAuthorityPDA, expectedMintAuthorityBump] =
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
          8 + 65
        ),
      ])
      .signers([canonicalData, canonicalAuthority])
      .rpc();

    wrappedMint = await createMint(
      provider.connection,
      wallet.payer,
      canonicalAuthority.publicKey,
      null,
      wrappedDecimals
    );

    [wrappedTokenAccount, wrappedTokenAccountBump] =
      await PublicKey.findProgramAddress(
        [TOKEN_ACCOUNT_SEED, canonicalMint.toBuffer(), wrappedMint.toBuffer()],
        canSwap.programId
      );

    [wrappedTokenAccountAuthority, wrappedTokenAccountAuthorityBump] =
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
        await canSwap.account.wrappedData.createInstruction(
          wrappedData,
          8 + 67
        ),
      ])
      .signers([wrappedData, canonicalAuthority])
      .rpc();
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
        canonicalMint.toString()
      );

      expect(postTxCanonicalData.decimals).to.eq(canonicalDecimals);

      const mintInfo = await getMint(provider.connection, canonicalMint);

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

      expect(postTxWrappedData.mint.toString()).to.eq(wrappedMint.toString());

      expect(postTxWrappedData.decimals).to.eq(wrappedDecimals);
      expect(postTxWrappedData.swapWrappedForCanonicalEnabled).to.be.true;
      expect(postTxWrappedData.swapCanonicalForWrappedEnabled).to.be.true;

      const accountInfo = await getAccount(
        provider.connection,
        wrappedTokenAccount
      );

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

  describe("#swapCanonicalForWrappedEnabled", () => {
    it("disables swapCanonicalForWrapped", async () => {
      const preTxWrappedData = await canSwap.account.wrappedData.fetch(
        wrappedData.publicKey
      );
      expect(preTxWrappedData.swapCanonicalForWrappedEnabled).to.be.true;

      await canSwap.methods
        .disableWrappedToken(false)
        .accounts({
          currentAuthority: canonicalAuthority.publicKey,
          canonicalData: canonicalData.publicKey,
          wrappedData: wrappedData.publicKey,
        })
        .signers([canonicalAuthority])
        .rpc();

      const postTxWrappedData = await canSwap.account.wrappedData.fetch(
        wrappedData.publicKey
      );

      expect(postTxWrappedData.swapCanonicalForWrappedEnabled).to.be.false;
    });

    it("fails swap when disabled", async () => {
      const sourceTokenAccount = await createAccount(
        provider.connection,
        wallet.payer,
        canonicalMint,
        wallet.publicKey,
        Keypair.generate()
      );

      const destinationTokenAccount = await createAccount(
        provider.connection,
        wallet.payer,
        wrappedMint,
        wallet.publicKey,
        Keypair.generate()
      );

      const destinationAmount = BigInt(10);
      const sourceAmount = destinationAmount * BigInt(10);

      await transfer(
        provider.connection,
        wallet.payer,
        tokenDistributorTokenAccount,
        sourceTokenAccount,
        wallet.publicKey,
        sourceAmount
      );

      const failedSwap = canSwap.methods
        .swapCanonicalForWrapped(
          new BN(destinationAmount),
          wrappedTokenAccountAuthorityBump
        )
        .accounts({
          user: wallet.publicKey,
          sourceCanonicalTokenAccount: sourceTokenAccount,
          canonicalMint: canonicalMint,
          destinationWrappedTokenAccount: destinationTokenAccount,
          wrappedTokenAccount,
          pdaWrappedTokenAuthority: wrappedTokenAccountAuthority,
          canonicalData: canonicalData.publicKey,
          wrappedData: wrappedData.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([wallet.payer])
        .rpc();

      await expect(failedSwap).to.eventually.be.rejectedWith(
        "AnchorError caused by account: wrapped_data. Error Code: ConstraintRaw. Error Number: 2003. Error Message: A raw constraint was violated."
      );
    });

    it("enables the wrapped token", async () => {
      const preTxWrappedData = await canSwap.account.wrappedData.fetch(
        wrappedData.publicKey
      );
      expect(preTxWrappedData.swapCanonicalForWrappedEnabled).to.be.false;

      await canSwap.methods
        .enableWrappedToken(false)
        .accounts({
          currentAuthority: canonicalAuthority.publicKey,
          canonicalData: canonicalData.publicKey,
          wrappedData: wrappedData.publicKey,
        })
        .signers([canonicalAuthority])
        .rpc();

      const postTxWrappedData = await canSwap.account.wrappedData.fetch(
        wrappedData.publicKey
      );

      expect(postTxWrappedData.swapCanonicalForWrappedEnabled).to.be.true;
    });
  });

  describe("#swapWrappedForCanonicalEnabled", () => {
    it("disables swapWrappedForCanonical", async () => {
      const preTxWrappedData = await canSwap.account.wrappedData.fetch(
        wrappedData.publicKey
      );
      expect(preTxWrappedData.swapWrappedForCanonicalEnabled).to.be.true;

      await canSwap.methods
        .disableWrappedToken(true)
        .accounts({
          currentAuthority: canonicalAuthority.publicKey,
          canonicalData: canonicalData.publicKey,
          wrappedData: wrappedData.publicKey,
        })
        .signers([canonicalAuthority])
        .rpc();

      const postTxWrappedData = await canSwap.account.wrappedData.fetch(
        wrappedData.publicKey
      );

      expect(postTxWrappedData.swapWrappedForCanonicalEnabled).to.be.false;
    });

    it("fails swap when disabled", async () => {
      const destinationTokenAccount = await createAccount(
        provider.connection,
        wallet.payer,
        canonicalMint,
        wallet.publicKey,
        Keypair.generate()
      );

      const sourceTokenAccount = await createAccount(
        provider.connection,
        wallet.payer,
        wrappedMint,
        wallet.publicKey,
        Keypair.generate()
      );

      const destinationAmount = BigInt(100);
      const sourceAmount = destinationAmount / BigInt(10);

      await mintTo(
        provider.connection,
        canonicalAuthority,
        wrappedMint,
        sourceTokenAccount,
        canonicalAuthority.publicKey,
        sourceAmount
      );

      const failedSwap = canSwap.methods
        .swapWrappedForCanonical(
          new BN(destinationAmount),
          expectedMintAuthorityBump
        )
        .accounts({
          user: wallet.publicKey,
          destinationCanonicalTokenAccount: destinationTokenAccount,
          canonicalMint: canonicalMint,
          wrappedTokenMint: wrappedMint,
          pdaCanonicalMintAuthority: expectedMintAuthorityPDA,
          sourceWrappedTokenAccount: sourceTokenAccount,
          wrappedTokenAccount,
          canonicalData: canonicalData.publicKey,
          wrappedData: wrappedData.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([wallet.payer])
        .rpc();

      await expect(failedSwap).to.eventually.be.rejectedWith(
        "AnchorError caused by account: wrapped_data. Error Code: ConstraintRaw. Error Number: 2003. Error Message: A raw constraint was violated."
      );
    });

    it("enables the wrapped token", async () => {
      const preTxWrappedData = await canSwap.account.wrappedData.fetch(
        wrappedData.publicKey
      );
      expect(preTxWrappedData.swapWrappedForCanonicalEnabled).to.be.false;

      await canSwap.methods
        .enableWrappedToken(true)
        .accounts({
          currentAuthority: canonicalAuthority.publicKey,
          canonicalData: canonicalData.publicKey,
          wrappedData: wrappedData.publicKey,
        })
        .signers([canonicalAuthority])
        .rpc();

      const postTxWrappedData = await canSwap.account.wrappedData.fetch(
        wrappedData.publicKey
      );

      expect(postTxWrappedData.swapWrappedForCanonicalEnabled).to.be.true;
    });
  });

  describe("#swap_wrapped_for_canonical", () => {
    it("destination token account must be a valid PDA", async () => {
      const destinationTokenAccount = await createAccount(
        provider.connection,
        wallet.payer,
        canonicalMint,
        wallet.publicKey,
        Keypair.generate()
      );

      const sourceTokenAccount = await createAccount(
        provider.connection,
        wallet.payer,
        wrappedMint,
        wallet.publicKey,
        Keypair.generate()
      );

      const destinationAmount = BigInt(100);
      const sourceAmount = destinationAmount / BigInt(10);

      await mintTo(
        provider.connection,
        canonicalAuthority,
        wrappedMint,
        sourceTokenAccount,
        canonicalAuthority.publicKey,
        sourceAmount
      );

      const preTxDestinationTokenAccount = await getAccount(
        provider.connection,
        destinationTokenAccount
      );
      expect(preTxDestinationTokenAccount.amount).to.eq(BigInt(0));

      const preTxSourceTokenAccount = await getAccount(
        provider.connection,
        sourceTokenAccount
      );

      expect(preTxSourceTokenAccount.amount).to.eq(sourceAmount);

      const failedSwap = canSwap.methods
        .swapWrappedForCanonical(
          new BN(destinationAmount),
          expectedMintAuthorityBump
        )
        .accounts({
          user: wallet.publicKey,
          destinationCanonicalTokenAccount: destinationTokenAccount,
          canonicalMint: canonicalMint,
          wrappedTokenMint: wrappedMint,
          pdaCanonicalMintAuthority: expectedMintAuthorityPDA,
          sourceWrappedTokenAccount: sourceTokenAccount,
          wrappedTokenAccount: sourceTokenAccount,
          canonicalData: canonicalData.publicKey,
          wrappedData: wrappedData.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([wallet.payer])
        .rpc();

      await expect(failedSwap).to.eventually.be.rejectedWith(
        "AnchorError caused by account: wrapped_token_account. Error Code: ConstraintSeeds. Error Number: 2006. Error Message: A seeds constraint was violated."
      );

      const postTxDestinationTokenAccount = await getAccount(
        provider.connection,
        destinationTokenAccount
      );
      expect(postTxDestinationTokenAccount.amount).to.eq(BigInt(0));

      const postTxSourceTokenAccount = await getAccount(
        provider.connection,
        sourceTokenAccount
      );

      expect(postTxSourceTokenAccount.amount).to.eq(sourceAmount);
    });

    it("takes wrapped from source and mints canonical into destination", async () => {
      const destinationTokenAccount = await createAccount(
        provider.connection,
        wallet.payer,
        canonicalMint,
        wallet.publicKey,
        Keypair.generate()
      );

      const sourceTokenAccount = await createAccount(
        provider.connection,
        wallet.payer,
        wrappedMint,
        wallet.publicKey,
        Keypair.generate()
      );

      const destinationAmount = BigInt(100);
      const sourceAmount = destinationAmount / BigInt(10);

      await mintTo(
        provider.connection,
        canonicalAuthority,
        wrappedMint,
        sourceTokenAccount,
        canonicalAuthority.publicKey,
        sourceAmount
      );

      const preTxDestinationTokenAccount = await getAccount(
        provider.connection,
        destinationTokenAccount
      );
      expect(preTxDestinationTokenAccount.amount).to.eq(BigInt(0));

      const preTxSourceTokenAccount = await getAccount(
        provider.connection,
        sourceTokenAccount
      );

      expect(preTxSourceTokenAccount.amount).to.eq(sourceAmount);

      await canSwap.methods
        .swapWrappedForCanonical(
          new BN(destinationAmount),
          expectedMintAuthorityBump
        )
        .accounts({
          user: wallet.publicKey,
          destinationCanonicalTokenAccount: destinationTokenAccount,
          canonicalMint: canonicalMint,
          wrappedTokenMint: wrappedMint,
          pdaCanonicalMintAuthority: expectedMintAuthorityPDA,
          sourceWrappedTokenAccount: sourceTokenAccount,
          wrappedTokenAccount,
          canonicalData: canonicalData.publicKey,
          wrappedData: wrappedData.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([wallet.payer])
        .rpc();

      const postTxDestinationTokenAccount = await getAccount(
        provider.connection,
        destinationTokenAccount
      );
      expect(postTxDestinationTokenAccount.amount).to.eq(destinationAmount);

      const postTxSourceTokenAccount = await getAccount(
        provider.connection,
        sourceTokenAccount
      );

      expect(postTxSourceTokenAccount.amount).to.eq(BigInt(0));
    });

    it("ensures rounding doesn't benefit the user", async () => {
      const destinationTokenAccount = await createAccount(
        provider.connection,
        wallet.payer,
        canonicalMint,
        wallet.publicKey,
        Keypair.generate()
      );

      const sourceTokenAccount = await createAccount(
        provider.connection,
        wallet.payer,
        wrappedMint,
        wallet.publicKey,
        Keypair.generate()
      );

      const destinationAmount = BigInt(1);

      const preTxDestinationTokenAccount = await getAccount(
        provider.connection,
        destinationTokenAccount
      );

      expect(preTxDestinationTokenAccount.amount).to.eq(BigInt(0));

      await canSwap.methods
        .swapWrappedForCanonical(
          new BN(destinationAmount),
          expectedMintAuthorityBump
        )
        .accounts({
          user: wallet.publicKey,
          destinationCanonicalTokenAccount: destinationTokenAccount,
          canonicalMint: canonicalMint,
          wrappedTokenMint: wrappedMint,
          pdaCanonicalMintAuthority: expectedMintAuthorityPDA,
          sourceWrappedTokenAccount: sourceTokenAccount,
          wrappedTokenAccount,
          canonicalData: canonicalData.publicKey,
          wrappedData: wrappedData.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([wallet.payer])
        .rpc();

      const postTxDestinationTokenAccount = await getAccount(
        provider.connection,
        destinationTokenAccount
      );
      expect(postTxDestinationTokenAccount.amount).to.eq(BigInt(0));

      const postTxSourceTokenAccount = await getAccount(
        provider.connection,
        sourceTokenAccount
      );
      expect(postTxSourceTokenAccount.amount).to.eq(BigInt(0));
    });
  });

  describe("#swap_canonical_for_wrapped", () => {
    it("burns canonical from source and transfers wrapped into destination", async () => {
      const sourceTokenAccount = await createAccount(
        provider.connection,
        wallet.payer,
        canonicalMint,
        wallet.publicKey,
        Keypair.generate()
      );

      const destinationTokenAccount = await createAccount(
        provider.connection,
        wallet.payer,
        wrappedMint,
        wallet.publicKey,
        Keypair.generate()
      );

      const destinationAmount = BigInt(10);
      const sourceAmount = destinationAmount * BigInt(10);

      await transfer(
        provider.connection,
        wallet.payer,
        tokenDistributorTokenAccount,
        sourceTokenAccount,
        wallet.publicKey,
        sourceAmount
      );

      const preTxDestinationTokenAccount = await getAccount(
        provider.connection,
        destinationTokenAccount
      );

      expect(preTxDestinationTokenAccount.amount).to.eq(BigInt(0));

      const preTxSourceTokenAccount = await getAccount(
        provider.connection,
        sourceTokenAccount
      );

      expect(preTxSourceTokenAccount.amount).to.eq(sourceAmount);

      await canSwap.methods
        .swapCanonicalForWrapped(
          new BN(destinationAmount),
          wrappedTokenAccountAuthorityBump
        )
        .accounts({
          user: wallet.publicKey,
          sourceCanonicalTokenAccount: sourceTokenAccount,
          canonicalMint: canonicalMint,
          destinationWrappedTokenAccount: destinationTokenAccount,
          wrappedTokenAccount,
          pdaWrappedTokenAuthority: wrappedTokenAccountAuthority,
          canonicalData: canonicalData.publicKey,
          wrappedData: wrappedData.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([wallet.payer])
        .rpc();

      const postTxDestinationTokenAccount = await getAccount(
        provider.connection,
        destinationTokenAccount
      );
      expect(postTxDestinationTokenAccount.amount).to.eq(destinationAmount);

      const postTxSourceTokenAccount = await getAccount(
        provider.connection,
        sourceTokenAccount
      );
      expect(postTxSourceTokenAccount.amount).to.eq(BigInt(0));
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

      await canSwap.methods
        .setCanonicalSwapAuthority()
        .accounts({
          currentAuthority: canonicalAuthority.publicKey,
          newAuthority: newAuthority.publicKey,
          canonicalData: canonicalData.publicKey,
        })
        .signers([canonicalAuthority])
        .rpc();

      const postTxCanonicalData = await canSwap.account.canonicalData.fetch(
        canonicalData.publicKey
      );

      expect(postTxCanonicalData.authority.toString()).to.eq(
        newAuthority.publicKey.toString()
      );

      // set back to original
      await canSwap.methods
        .setCanonicalSwapAuthority()
        .accounts({
          currentAuthority: newAuthority.publicKey,
          newAuthority: canonicalAuthority.publicKey,
          canonicalData: canonicalData.publicKey,
        })
        .signers([newAuthority])
        .rpc();
    });
  });
});
