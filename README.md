# Canonical Swap

This repository contains a solana program for swapping whitelisted wrapped tokens for a single canonical token.

This allows flexibility for tokens with supply originating on other chains to be bridge agnostic on solana and have a `canonical` token for usage while allowing any whitelisted bridge wrapped token to be the original token on the network.

It does this by taking mint authority for the given canonical token and mints/burns canonical tokens as wrapped tokens are swapped in/out of the program.

THE MINT AUTHORITY TRANSFER IS A ONE WAY TRANSFER. There is no way to return the mint authority back to the original account. This program is intended to be immutable and has only one safety precaution; whichever account has the authority (see [`set_canonical_swap_authority`](./programs/canonical-swap/src/lib.rs#L197) to transfer this authority) can pause or unpause a whitelisted wrapped token. See [pause and unpause here](./programs/canonical-swap/src/lib.rs#L181-L194).

## Mainnet deploy

This program is deployed on mainnet with Program Id: `CNSWAP9TsKjy3Ux1QxptQS2RFAiP5Eucf4odRHueNwzm`

Source has been verified [here](https://anchor.projectserum.com/build/48)

## Local build and test

Must have node and rust installed and functioning

Install deps:

```sh
yarn
```

Build:

```sh
yarn build
```

Test:

```sh
yarn yarn
```

## Setting up a new canonical token and whitelisting wrapped tokens

There is currently no interface to accomplish initialization or swapping and it must be done via scripts. See [`scripts`](./scripts). for the source of each task.

### Set up env vars

The following must be set for all scripts

```sh
ANCHOR_WALLET=./path
ANCHOR_PROVIDER_URL=url
```

### Initialize the Canonical token

set [`canonicalMint`](./scripts/init_canonical.ts#L22) to the canonical token mint pubkey, the signer of this tx must have mint authority for this token.

```sh
npx ts-node ./scripts/init_canonical.ts
```

### Initialize n Wrapped token(s)

Signer must be the same as prior step or be the current authority if a new authority has been set

set [`canonicalMint`](./scripts/init_wrapped.ts#L26) to the same as the above

set [`wrappedMint`](./scripts/init_wrapped.ts#L29) to the wrapped token mint you'd like to support

set [`canonicalData`](./scripts/init_wrapped.ts#L32) to the key generated and output when running `init_canonical.ts`

## Swapping canonical<->Wrapped tokens

### Swap wrapped for canonical

See [`scripts/swap_wrapped_for_canonical.ts`](./scripts/swap_wrapped_for_canonical.ts) example.

### Swap wrapped for canonical

See [`scripts/swap_canonical_for_wrapped.ts`](./scripts/swap_canonical_for_wrapped.ts) example.

## Licensing

Licensed under the MIT license, see [`LICENSE`](./LICENSE.txt).
