import { utils as anchorUtils } from "@project-serum/anchor";

import { PublicKey } from "@solana/web3.js";

export const CANONICAL_SWAP_PROGRAM_ID = new PublicKey(
  "CNSWAP9TsKjy3Ux1QxptQS2RFAiP5Eucf4odRHueNwzm"
);

export const CANONICAL_MINT_AUTHORITY_PDA_SEED = Buffer.from(
  anchorUtils.bytes.utf8.encode("can_mint_authority")
);

export const WRAPPED_TOKEN_OWNER_AUTHORITY_PDA_SEED = Buffer.from(
  anchorUtils.bytes.utf8.encode("wrapped_acct_authority")
);

export const TOKEN_ACCOUNT_SEED = Buffer.from(
  anchorUtils.bytes.utf8.encode("token_account_seed")
);
