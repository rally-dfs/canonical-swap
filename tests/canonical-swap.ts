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
import assert from "assert";
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
  anchor.utils.bytes.utf8.encode("token-account-seed")
);

describe("canonical-swap", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.Provider.env();
  anchor.setProvider(provider);

  const canSwap = anchor.workspace.CanonicalSwap as Program<CanonicalSwap>;

  const canonicalAuthority = Keypair.generate();
  const canonicalData = anchor.web3.Keypair.generate();

  const canonicalDecimals = 6;

  const wallet = provider.wallet as anchor.Wallet;
  // const wallet = anchor.Wallet.local();

  let canonicalMint: Token;
  let expectedMintAuthorityPDA: [PublicKey, number];

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

    expectedMintAuthorityPDA = await PublicKey.findProgramAddress(
      [CANONICAL_MINT_AUTHORITY_PDA_SEED],
      canSwap.programId
    );
  });

  it("Initializes and creates a PDA to have mint authority", async () => {
    const tx = await canSwap.rpc.initializeCanonicalToken(canonicalDecimals, {
      accounts: {
        initializer: canonicalAuthority.publicKey,
        canonicalMint: canonicalMint.publicKey,
        canonicalData: canonicalData.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      },
      instructions: [
        await canSwap.account.canonicalData.createInstruction(canonicalData),
      ],
      signers: [canonicalData, canonicalAuthority],
    });

    let postTxCanonicalData = await canSwap.account.canonicalData.fetch(
      canonicalData.publicKey
    );

    assert.ok(
      postTxCanonicalData.initializer.equals(canonicalAuthority.publicKey)
    );
    assert.ok(postTxCanonicalData.mint.equals(canonicalMint.publicKey));
    assert.ok(postTxCanonicalData.decimals === canonicalDecimals);

    const mintInfo = await canonicalMint.getMintInfo();
    assert.ok(mintInfo.mintAuthority.equals(expectedMintAuthorityPDA[0]));
  });

  it("initializes and whitelists wrapped token", async () => {
    const wrappedDecimals = 8;
    const wrappedData = anchor.web3.Keypair.generate();

    const wrappedMint = await Token.createMint(
      provider.connection,
      wallet.payer,
      canonicalAuthority.publicKey,
      null,
      wrappedDecimals,
      TOKEN_PROGRAM_ID
    );

    const [wrappedTokenAccount, wrappedTokenAccountBump] =
      await PublicKey.findProgramAddress(
        [TOKEN_ACCOUNT_SEED],
        canSwap.programId
      );

    const tx = await canSwap.rpc.initializeWrappedToken(
      wrappedDecimals,
      wrappedTokenAccountBump,
      {
        accounts: {
          initializer: canonicalAuthority.publicKey,
          wrappedTokenMint: wrappedMint.publicKey,
          wrappedTokenAccount,
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

    let postTxWrappedData = await canSwap.account.wrappedData.fetch(
      wrappedData.publicKey
    );

    assert.ok(postTxWrappedData.canonicalData.equals(canonicalData.publicKey));
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
