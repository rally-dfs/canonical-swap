import {
  Program,
  Provider,
  setProvider,
  utils as anchorUtils,
  Wallet,
} from "@project-serum/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  CANONICAL_MINT_AUTHORITY_PDA_SEED,
  CANONICAL_SWAP_PROGRAM_ID,
} from "./constants";
import { CanonicalSwap } from "../target/types/canonical_swap";
import idl from "../target/idl/canonical_swap.json";

// This script configures the client to read from env.
// ANCHOR_WALLET=./path and ANCHOR_PROVIDER_URL=url
// must be set

// This is the mint you intend to transfer mint authority for
const canonicalMint = new PublicKey("");

const main = async () => {
  // Configure the client to use the local cluster.
  const provider = Provider.env();
  setProvider(provider);
  const wallet = provider.wallet as Wallet;

  // Generate the program client from IDL.
  const canSwap = new Program(
    idl as any,
    CANONICAL_SWAP_PROGRAM_ID,
    provider
  ) as Program<CanonicalSwap>;

  const canonicalAuthority = wallet.payer;
  const canonicalData = Keypair.generate();

  console.log(
    "CanonicalData Pubkey (save this): ",
    canonicalData.publicKey.toString()
  );

  const [expectedMintAuthorityPDA, expectedMintAuthorityBump] =
    await PublicKey.findProgramAddress(
      [CANONICAL_MINT_AUTHORITY_PDA_SEED, canonicalMint.toBuffer()],
      canSwap.programId
    );

  const tx = await canSwap.rpc.initializeCanonicalToken(
    expectedMintAuthorityBump,
    {
      accounts: {
        initializer: canonicalAuthority.publicKey,
        canonicalMint: canonicalMint,
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
    }
  );

  console.log(tx);
};

main();
