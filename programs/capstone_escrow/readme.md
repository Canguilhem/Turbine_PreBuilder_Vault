Airdrop contract + vesting relying on merkletree

requirements:

- generate merkletree based on

address, amount

init:

- provide merkleroot
- time window
- user allocation (same amount for each address)

claim:

- provide merkleleaf (address, amount) + proof -> verify merkleleaf
- linear release of funds

1. setup if needed

init a pda (user_claim_vault) which stores

- the amount claim so far
- last claim timestamp
- user_vault_ATA (token account holding unvested tokens)

2. compute if any token should be transfered
3. transfer tokens

- if first claim:
  -- transfer from general_vault_ATA
  --- transfer vested (claimable) amount to user_ATA
  --- transfer unvested (to be claimed) amount to user_vault_ATA
- otherwise transfer from user_vault_ATA to user_ATA
