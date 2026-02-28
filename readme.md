## Simple Vault implementation

User can:

- deposit X amount
- withdraw X amount
- close the vault

## Simple Escrow implementation (1:1 token transfers)

- Make:
  Maker deposit N_amount of token-A
  token-A are escrowed until refund or take instructions

- Refund:
  Refund escrow maker their deposit and close the escrow

- Take:
  Taker sends N_amount of token-B to Maker
  Taker receives token-A from escrow
  Escrow is closed and remaining lamports sent back to taker

## Capstone escrow implementation

Contract core logic is to lock and distribute tokens to whitelisted addresses on a linear basis.

- Whitelist is controlled via a merkletree
- Token distribution is linear over time

=> at any point in time:

vestedTokens = allocation \* elapsed / timeWindow

where:
elapsed = now - start
timeWindow = end - start

### Deploy commands

anchor build
anchor deploy --provider.cluster devnet --program-name capstone_escrow

### Testing

surfpool start -> will run deployment runbook by default
anchor test --skip-local-validator
