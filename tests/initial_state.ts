import {
  AnchorProvider,
  Program,
  setProvider,
  Wallet,
  workspace,
} from "@project-serum/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  getMint,
  getAccount,
  TOKEN_PROGRAM_ID,
  createMint,
} from "@solana/spl-token";
import { CanonicalSwap } from "../target/types/canonical_swap";
import {
  expect,
  fixture,
  TOKEN_ACCOUNT_SEED,
  WRAPPED_TOKEN_OWNER_AUTHORITY_PDA_SEED,
} from "./shared";

describe("Initial State", () => {
  // Configure the client to use the local cluster.
  const provider = AnchorProvider.local();
  setProvider(provider);

  const canSwap = workspace.CanonicalSwap as Program<CanonicalSwap>;
  const wallet = provider.wallet as Wallet;

  let canonicalAuthority: Keypair;
  let canonicalData: Keypair;
  let wrappedData: Keypair;

  let canonicalDecimals: number;
  let wrappedDecimals: number;

  let canonicalMint: PublicKey;
  let expectedMintAuthorityPDA: PublicKey;

  let wrappedMint: PublicKey;
  let wrappedTokenAccount: PublicKey;
  let wrappedTokenAccountAuthority: PublicKey;

  beforeEach("Set up fresh accounts", async () => {
    ({
      canonicalAuthority,
      canonicalData,
      wrappedData,
      canonicalDecimals,
      wrappedDecimals,
      canonicalMint,
      expectedMintAuthorityPDA,
      wrappedMint,
      wrappedTokenAccount,
      wrappedTokenAccountAuthority,
    } = await fixture(provider, wallet, canSwap));
  });

  describe("#initializeCanonicalToken", () => {
    it("Make sure initialized canonical token has set proper account data", async () => {
      const postTxCanonicalData = await canSwap.account.canonicalData.fetch(
        canonicalData.publicKey
      );

      expect(postTxCanonicalData.authority).to.deep.eq(
        canonicalAuthority.publicKey
      );

      expect(postTxCanonicalData.mint).to.deep.eq(canonicalMint);

      expect(postTxCanonicalData.decimals).to.eq(canonicalDecimals);

      const mintInfo = await getMint(provider.connection, canonicalMint);

      expect(mintInfo.mintAuthority).to.deep.eq(expectedMintAuthorityPDA);

      const dataAcctSolBalance = await provider.connection.getBalance(
        canonicalData.publicKey
      );

      expect(dataAcctSolBalance).to.be.greaterThan(0);

      const dataAcctInfo = await provider.connection.getAccountInfo(
        canonicalData.publicKey
      );

      expect(dataAcctInfo.owner).to.deep.eq(canSwap.programId);
    });
  });

  describe("#initializeWrappedToken", () => {
    it("Make sure initialized wrapped token has set proper account data", async () => {
      const postTxWrappedData = await canSwap.account.wrappedData.fetch(
        wrappedData.publicKey
      );

      expect(postTxWrappedData.canonicalData).to.deep.eq(
        canonicalData.publicKey
      );

      expect(postTxWrappedData.mint).to.deep.eq(wrappedMint);

      expect(postTxWrappedData.decimals).to.eq(wrappedDecimals);
      expect(postTxWrappedData.swapWrappedForCanonicalEnabled).to.be.true;
      expect(postTxWrappedData.swapCanonicalForWrappedEnabled).to.be.true;

      const accountInfo = await getAccount(
        provider.connection,
        wrappedTokenAccount
      );

      expect(accountInfo.owner).to.deep.eq(wrappedTokenAccountAuthority);

      const dataAcctSolBalance = await provider.connection.getBalance(
        wrappedData.publicKey
      );

      expect(dataAcctSolBalance).to.be.greaterThan(0);

      const dataAcctInfo = await provider.connection.getAccountInfo(
        wrappedData.publicKey
      );

      expect(dataAcctInfo.owner).to.deep.eq(canSwap.programId);
    });

    it("Fails to initialize a wrapped token if not the canonical authority", async () => {
      const badWrappedData = Keypair.generate();
      const badWrappedMint = await createMint(
        provider.connection,
        wallet.payer,
        wallet.publicKey,
        null,
        wrappedDecimals
      );

      const [badWrappedTokenAccount] = await PublicKey.findProgramAddress(
        [
          TOKEN_ACCOUNT_SEED,
          canonicalMint.toBuffer(),
          badWrappedMint.toBuffer(),
        ],
        canSwap.programId
      );

      const [badWrappedTokenAccountAuthority] =
        await PublicKey.findProgramAddress(
          [
            WRAPPED_TOKEN_OWNER_AUTHORITY_PDA_SEED,
            canonicalMint.toBuffer(),
            badWrappedMint.toBuffer(),
          ],
          canSwap.programId
        );

      const failedTx = canSwap.methods
        .initializeWrappedToken()
        .accounts({
          currentAuthority: wallet.publicKey,
          wrappedTokenMint: badWrappedMint,
          pdaWrappedTokenAccount: badWrappedTokenAccount,
          pdaWrappedTokenAccountAuthority: badWrappedTokenAccountAuthority,
          canonicalData: canonicalData.publicKey,
          wrappedData: badWrappedData.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([
          await canSwap.account.wrappedData.createInstruction(
            badWrappedData,
            8 + 68
          ),
        ])
        .signers([badWrappedData, wallet.payer])
        .rpc();

      await expect(failedTx).to.eventually.be.rejectedWith(
        "AnchorError caused by account: canonical_data. Error Code: ConstraintRaw. Error Number: 2003. Error Message: A raw constraint was violated."
      );
    });
  });
});
