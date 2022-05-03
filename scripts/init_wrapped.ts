import {
  AnchorProvider,
  Program,
  setProvider,
  Wallet,
  web3,
} from "@project-serum/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  CANONICAL_SWAP_PROGRAM_ID,
  TOKEN_ACCOUNT_SEED,
  WRAPPED_TOKEN_OWNER_AUTHORITY_PDA_SEED,
} from "./constants";
import { CanonicalSwap } from "../target/types/canonical_swap";
import idl from "../target/idl/canonical_swap.json";

// This script configures the client to read from env.
// ANCHOR_WALLET=./path and ANCHOR_PROVIDER_URL=url
// must be set

// YOU MUST ALSO FILL OUT THE FOLLOWING PUBKEYS BEFORE USE

// Canonical token mint address
const canonicalMint = new PublicKey("");

// Wrapped token mint address (from wormhole and the like)
const wrappedMint = new PublicKey("");

// FROM OUTPUT OF init_canonical.ts
const canonicalData = new PublicKey("");

const main = async () => {
  // Configure the client to use the local cluster.
  const provider = AnchorProvider.env();
  setProvider(provider);
  const wallet = provider.wallet as Wallet;

  // Generate the program client from IDL.
  const canSwap = new Program(
    idl as any,
    CANONICAL_SWAP_PROGRAM_ID,
    provider
  ) as Program<CanonicalSwap>;

  const canonicalAuthority = wallet.payer;
  const wrappedData = Keypair.generate();

  console.log(
    "WrappedData Pubkey (save this): ",
    wrappedData.publicKey.toString()
  );

  const [wrappedTokenAccount] = await PublicKey.findProgramAddress(
    [TOKEN_ACCOUNT_SEED, canonicalMint.toBuffer(), wrappedMint.toBuffer()],
    canSwap.programId
  );

  const [wrappedTokenAccountAuthority] = await PublicKey.findProgramAddress(
    [
      WRAPPED_TOKEN_OWNER_AUTHORITY_PDA_SEED,
      canonicalMint.toBuffer(),
      wrappedMint.toBuffer(),
    ],
    canSwap.programId
  );

  const tx = await canSwap.methods
    .initializeWrappedToken()
    .accounts({
      currentAuthority: canonicalAuthority.publicKey,
      wrappedTokenMint: wrappedMint,
      pdaWrappedTokenAccount: wrappedTokenAccount,
      pdaWrappedTokenAccountAuthority: wrappedTokenAccountAuthority,
      canonicalData: canonicalData,
      wrappedData: wrappedData.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
      systemProgram: SystemProgram.programId,
    })
    .preInstructions([
      await canSwap.account.wrappedData.createInstruction(wrappedData, 8 + 66),
    ])
    .signers([wrappedData, canonicalAuthority])
    .rpc();

  console.log(tx);
};

main();
