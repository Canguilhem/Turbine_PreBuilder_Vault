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
