import {
  AnchorProvider,
  BN,
  Program,
  Provider,
  setProvider,
  utils as anchorUtils,
  Wallet,
} from "@project-serum/anchor";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  CANONICAL_MINT_AUTHORITY_PDA_SEED,
  CANONICAL_SWAP_PROGRAM_ID,
  TOKEN_ACCOUNT_SEED,
  WRAPPED_TOKEN_OWNER_AUTHORITY_PDA_SEED,
} from "./constants";
import { CanonicalSwap } from "../target/types/canonical_swap";
import idl from "../target/idl/canonical_swap.json";

// This script configures the client to read from env.
// ANCHOR_WALLET=./path and ANCHOR_PROVIDER_URL=url
// must be set

// Amount you'd like to end up with after swap (in lamports)
// Decimal conversion must be accounted for
const destinationAmount = new BN(0);

// YOU MUST ALSO FILL OUT THE FOLLOWING PUBKEYS BEFORE USE

// Canonical token mint address
const canonicalMint = new PublicKey("");

// Wrapped token mint address (from wormhole and the like)
const wrappedMint = new PublicKey("");

// FROM OUTPUT OF init_canonical.ts
const canonicalData = new PublicKey("");

// FROM OUTPUT OF init_wrapped.ts
const wrappedData = new PublicKey("");

// Wrapped token account
const sourceTokenAccount = new PublicKey("");

// Canonical token account, please read https://spl.solana.com/token#example-transferring-tokens-to-an-explicit-recipient-token-account
// if you do not have one
// (TL;DR) run $ spl-token create-account CANONICAL_MINT_PUBKEY_HERE
const destinationTokenAccount = new PublicKey("");

const main = async () => {
  // Read info from from env
  const provider = AnchorProvider.env();
  setProvider(provider);
  const wallet = provider.wallet as Wallet;

  // Generate the program client from IDL.
  const canSwap = new Program(
    idl as any,
    CANONICAL_SWAP_PROGRAM_ID,
    provider
  ) as Program<CanonicalSwap>;

  const [wrappedTokenAccountAuthority, wrappedTokenAccountAuthorityBump] =
    await PublicKey.findProgramAddress(
      [
        WRAPPED_TOKEN_OWNER_AUTHORITY_PDA_SEED,
        canonicalMint.toBuffer(),
        wrappedMint.toBuffer(),
      ],
      canSwap.programId
    );

  const [wrappedTokenAccount] = await PublicKey.findProgramAddress(
    [TOKEN_ACCOUNT_SEED, canonicalMint.toBuffer(), wrappedMint.toBuffer()],
    canSwap.programId
  );

  const tx = await canSwap.methods
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
      canonicalData: canonicalData,
      wrappedData: wrappedData,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([wallet.payer])
    .rpc();

  console.log(tx);
};

main();
