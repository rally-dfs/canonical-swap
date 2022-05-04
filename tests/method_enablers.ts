import {
  AnchorProvider,
  BN,
  Program,
  setProvider,
  Wallet,
  workspace,
} from "@project-serum/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createAccount,
  TOKEN_PROGRAM_ID,
  getAccount,
  transfer,
  mintTo,
} from "@solana/spl-token";
import { CanonicalSwap } from "../target/types/canonical_swap";
import { expect, fixture } from "./shared";

describe("Method enablers", () => {
  // Configure the client to use the local cluster.
  const provider = AnchorProvider.local();
  setProvider(provider);

  const canSwap = workspace.CanonicalSwap as Program<CanonicalSwap>;
  const wallet = provider.wallet as Wallet;

  let tokenDistributorTokenAccount: PublicKey;

  let canonicalAuthority: Keypair;
  let canonicalData: Keypair;
  let wrappedData: Keypair;

  let canonicalMint: PublicKey;
  let expectedMintAuthorityPDA: PublicKey;

  let wrappedMint: PublicKey;
  let wrappedTokenAccount: PublicKey;
  let wrappedTokenAccountAuthority: PublicKey;

  let mintAuthorityBump: number;
  let wrappedTokenAccountAuthorityBump: number;

  beforeEach("Set up fresh accounts", async () => {
    ({
      tokenDistributorTokenAccount,
      canonicalAuthority,
      canonicalData,
      wrappedData,
      canonicalMint,
      expectedMintAuthorityPDA,
      wrappedMint,
      wrappedTokenAccount,
      wrappedTokenAccountAuthority,
    } = await fixture(provider, wallet, canSwap));
  });

  it("has a default enabled state", async () => {
    const preTxWrappedData = await canSwap.account.wrappedData.fetch(
      wrappedData.publicKey
    );
    expect(preTxWrappedData.swapCanonicalForWrappedEnabled).to.be.true;
    expect(preTxWrappedData.swapWrappedForCanonicalEnabled).to.be.true;
  });

  describe("authorization", () => {
    it("cannot be called by non authority account", async () => {
      const failedTx = canSwap.methods
        .disableWrappedToken(false)
        .accounts({
          currentAuthority: wallet.publicKey,
          canonicalData: canonicalData.publicKey,
          wrappedData: wrappedData.publicKey,
        })
        .signers([wallet.payer])
        .rpc();

      await expect(failedTx).to.eventually.be.rejectedWith(
        "AnchorError caused by account: canonical_data. Error Code: ConstraintRaw. Error Number: 2003. Error Message: A raw constraint was violated."
      );
    });
  });

  describe("#swapCanonicalForWrappedEnabled", () => {
    beforeEach("disable", async () => {
      await canSwap.methods
        .disableWrappedToken(false)
        .accounts({
          currentAuthority: canonicalAuthority.publicKey,
          canonicalData: canonicalData.publicKey,
          wrappedData: wrappedData.publicKey,
        })
        .signers([canonicalAuthority])
        .rpc();
    });

    it("is disabled", async () => {
      const postTxWrappedData = await canSwap.account.wrappedData.fetch(
        wrappedData.publicKey
      );

      expect(postTxWrappedData.swapCanonicalForWrappedEnabled).to.be.false;
    });

    it("fails swapCanonicalForWrapped when disabled", async () => {
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

      const failedSwap = canSwap.methods
        .swapCanonicalForWrapped(new BN(0))
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

    it("swapWrappedForCanonical allowed when disabled", async () => {
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

      await canSwap.methods
        .swapWrappedForCanonical(new BN(destinationAmount))
        .accounts({
          user: wallet.publicKey,
          destinationCanonicalTokenAccount: destinationTokenAccount,
          canonicalMint: canonicalMint,
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
    beforeEach("disable", async () => {
      await canSwap.methods
        .disableWrappedToken(true)
        .accounts({
          currentAuthority: canonicalAuthority.publicKey,
          canonicalData: canonicalData.publicKey,
          wrappedData: wrappedData.publicKey,
        })
        .signers([canonicalAuthority])
        .rpc();
    });

    it("is disabled", async () => {
      const postTxWrappedData = await canSwap.account.wrappedData.fetch(
        wrappedData.publicKey
      );

      expect(postTxWrappedData.swapWrappedForCanonicalEnabled).to.be.false;
    });

    it("fails swapWrappedForCanonical when disabled", async () => {
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

      const failedSwap = canSwap.methods
        .swapWrappedForCanonical(new BN(0))
        .accounts({
          user: wallet.publicKey,
          destinationCanonicalTokenAccount: destinationTokenAccount,
          canonicalMint: canonicalMint,
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

    it("swapCanonicalForWrapped allowed when disabled", async () => {
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

      await canSwap.methods
        .swapCanonicalForWrapped(new BN(destinationAmount))
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

    it("enables the wrapped token", async () => {
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
});
