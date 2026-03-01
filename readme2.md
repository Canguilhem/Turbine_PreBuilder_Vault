# Capstone Escrow Documentation

A Solana program for locking and linearly vesting tokens to whitelisted addresses over time. The whitelist is enforced via a Merkle tree, and token distribution follows a linear vesting schedule.

## Overview

The Capstone Escrow enables:

1. **Token locking** — A maker deposits tokens into a vault with configurable vesting parameters
2. **Whitelist access** — Only addresses in the Merkle tree can claim tokens
3. **Linear vesting** — Tokens vest proportionally to elapsed time within the vesting window
4. **Maker controls** — After vesting + grace period, the maker can clawback unclaimed tokens and close the vault

## Core Logic

At any point in time, the vested amount for a user is:

```
vestedTokens = allocation × elapsed / timeWindow
```

Where:

- **elapsed** = `now - start_timestamp`
- **timeWindow** = `end_timestamp - start_timestamp`
- **allocation** = per-user token allocation (from Merkle leaf)

If `now <= start`: vested = 0  
If `now >= end`: vested = full allocation  
Otherwise: vested is linearly interpolated between 0 and allocation.

## Program Instructions

### 1. `initialize`

Creates a new vault and deposits tokens.

| Parameter         | Type     | Description                                                                                    |
| ----------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `seed`            | u64      | Unique seed for vault PDA (maker + seed = unique vault)                                        |
| `merkle_root`     | [u8; 32] | Root of the Merkle tree encoding the whitelist                                                 |
| `start_timestamp` | u64      | Unix timestamp when vesting begins                                                             |
| `end_timestamp`   | u64      | Unix timestamp when vesting ends                                                               |
| `user_allocation` | u64      | Token amount per whitelisted user                                                              |
| `clawback_buffer` | u64      | Grace period (seconds) after `end_timestamp` before maker can clawback/close. Must be ≥ 7 days |
| `deposit`         | u64      | Token amount to deposit. Must be `> 0` and divisible by `user_allocation`                      |

**PDA seeds:** `["vault", maker, seed]`

**Validation:**

- `start_timestamp` < `end_timestamp` (both non-zero)
- `user_allocation` > 0
- `clawback_buffer` ≥ 7 days (604800 seconds)
- `deposit % user_allocation == 0`

---

### 2. `claim`

Allows a whitelisted user to claim vested tokens.

| Parameter | Type            | Description                                                  |
| --------- | --------------- | ------------------------------------------------------------ |
| `proofs`  | `Vec<[u8; 33]>` | Merkle proof (position byte + 32-byte sibling hash per step) |

**Flow:**

- **First claim:** User proves whitelist membership via Merkle proof. Tokens are split:
  - **Vested portion** → sent to user’s ATA
  - **Unvested portion** → sent to `user_vault_ata` (PDA-controlled interim account)
- **Later claims:** Only vested portion is moved from `user_vault_ata` to user’s ATA.
- When full allocation is claimed, the user’s claim account and `user_vault_ata` are closed.

**Constraints:**

- Vault must not have ended (i.e. `now < end_timestamp + grace_period`)
- Proofs must be provided on first claim
- Proofs may be omitted on subsequent claims

**PDA seeds (claim vault):** `["claim_vault", vault_pda, user]`

---

### 3. `clawback`

Maker reclaims unvested tokens from a user’s `user_vault_ata` back to the vault.

**Constraints:**

- `vault.has_ended()` must be true: `now >= end_timestamp + grace_period`
- Only the maker can call this
- Target user must have a `claim_vault` and `user_vault_ata` with remaining balance

After clawback, the user’s `claim_vault` and `user_vault_ata` are closed.

---

### 4. `close_vault`

Maker closes the vault and recovers any remaining tokens (e.g., unclaimed allocations).

**Constraints:**

- `vault.has_ended()` must be true
- Only the maker can call this

All remaining vault tokens are sent to the maker’s ATA, and the vault and vault ATA are closed.

## Account Structures

### Vault

| Field             | Type     | Description                                     |
| ----------------- | -------- | ----------------------------------------------- |
| `merkle_root`     | [u8; 32] | Merkle root for whitelist                       |
| `start_timestamp` | u64      | Vesting start time                              |
| `end_timestamp`   | u64      | Vesting end time                                |
| `seed`            | u64      | PDA seed                                        |
| `maker`           | Pubkey   | Creator/owner of the vault                      |
| `token_to_claim`  | Pubkey   | SPL token mint                                  |
| `user_allocation` | u64      | Tokens per whitelisted user                     |
| `grace_period`    | u64      | Seconds after end before clawback/close allowed |
| `bump`            | u8       | PDA bump                                        |

### ClaimVault

Per-user state for a vault, used to track claims and hold unvested tokens.

| Field                  | Type   | Description                 |
| ---------------------- | ------ | --------------------------- |
| `user`                 | Pubkey | Claiming user               |
| `amount`               | u64    | Total amount claimed so far |
| `last_claim_timestamp` | u64    | Timestamp of last claim     |
| `bump`                 | u8     | PDA bump                    |

## Merkle Tree & Whitelist

### Leaf Format

A leaf is hashed as:

```
keccak256(lowercase(address) + allocation)
```

- Address: Base58 public key, lowercased
- Allocation: `user_allocation` as string

### Proof Format

Each proof step is 33 bytes:

- Byte 0: Position (0 = right child → `hash(sibling, current)`, 1 = left child → `hash(current, sibling)`)
- Bytes 1–32: Sibling hash

### Generating the Whitelist

1. **CSV** (`utils/data/whitelist.csv`):

   ```csv
   wallet;amount
   <pubkey>;1000000000000
   ```

2. **Generate Merkle proofs:**

   ```
   yarn run generate-merkle-tree
   ```

   This writes `utils/data/merkle_proofs.json` with `merkleRoot` and proofs per address.

## Timeline Summary

- **Before start:** Users can claim; vested = 0, unvested goes to `user_vault_ata`
- **During vesting:** Users claim vested amount from vault or from `user_vault_ata`
- **After end, before grace ends:** No new claims; users can still claim any remaining vested from `user_vault_ata`
- **After grace period:** Vault is ended; maker can clawback and close vault

## Build & Deploy

```bash
anchor build
anchor deploy --provider.cluster devnet --program-name capstone_escrow
```

## Testing

```bash
# With local validator
anchor test

# Against existing validator (e.g. surfpool)
anchor test --skip-local-validator

# Against devnet
yarn run test:capstone:devnet
```

results in tests/results/capstone.png

## Program ID

- **Localnet / Devnet:** `3uc4VYyZysCNZ3zKGbcbNnARFi2fHEPrBSSCXGC5Qjwf`
