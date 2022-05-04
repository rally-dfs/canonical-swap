import {
  AnchorProvider,
  Program,
  setProvider,
  Wallet,
  workspace,
} from "@project-serum/anchor";
import { Keypair } from "@solana/web3.js";
import { CanonicalSwap } from "../target/types/canonical_swap";
import { expect, fixture } from "./shared";

describe("Set Authority", () => {
  // Configure the client to use the local cluster.
  const provider = AnchorProvider.local();
  setProvider(provider);

  const canSwap = workspace.CanonicalSwap as Program<CanonicalSwap>;
  const wallet = provider.wallet as Wallet;

  let canonicalAuthority: Keypair;
  let canonicalData: Keypair;

  beforeEach("Set up fresh accounts", async () => {
    ({ canonicalAuthority, canonicalData } = await fixture(
      provider,
      wallet,
      canSwap
    ));
  });

  describe("#set_canonical_swap_authority", () => {
    it("Sets new authority", async () => {
      const preTxCanonicalData = await canSwap.account.canonicalData.fetch(
        canonicalData.publicKey
      );
      expect(preTxCanonicalData.authority).to.deep.eq(
        canonicalAuthority.publicKey
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

      expect(postTxCanonicalData.authority).to.deep.eq(newAuthority.publicKey);
    });

    it("Fails to sets new authority when called from other account", async () => {
      const preTxCanonicalData = await canSwap.account.canonicalData.fetch(
        canonicalData.publicKey
      );
      expect(preTxCanonicalData.authority).to.deep.eq(
        canonicalAuthority.publicKey
      );

      const newAuthority = Keypair.generate();

      const failedTx = canSwap.methods
        .setCanonicalSwapAuthority()
        .accounts({
          currentAuthority: wallet.publicKey,
          newAuthority: newAuthority.publicKey,
          canonicalData: canonicalData.publicKey,
        })
        .signers([wallet.payer])
        .rpc();

      await expect(failedTx).to.eventually.be.rejectedWith(
        "AnchorError caused by account: canonical_data. Error Code: ConstraintRaw. Error Number: 2003. Error Message: A raw constraint was violated."
      );
    });
  });
});
