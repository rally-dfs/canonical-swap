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
  mintTo,
  TOKEN_PROGRAM_ID,
  getAccount,
  transfer,
} from "@solana/spl-token";
import { CanonicalSwap } from "../target/types/canonical_swap";
import { expect, fixture } from "./shared";

describe("Swaps", () => {
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

      const failedSwap = canSwap.methods
        .swapWrappedForCanonical(new BN(0))
        .accounts({
          user: wallet.publicKey,
          destinationCanonicalTokenAccount: destinationTokenAccount,
          canonicalMint: canonicalMint,
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
  });
});
