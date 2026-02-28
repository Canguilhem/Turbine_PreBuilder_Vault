import * as anchor from "@coral-xyz/anchor";
import { CapstoneEscrow } from "../target/types/capstone_escrow";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { expect } from "chai";

export function calculateExpectedVested(
  now: number,
  start: number,
  end: number,
  allocation: number,
): number {
  console.log({
    now,
    start,
    end,
  });
  if (now <= start) return 0;
  if (now >= end) return allocation;
  const elapsed = new anchor.BN(now).sub(new anchor.BN(start));
  const timeWindow = new anchor.BN(end).sub(new anchor.BN(start));
  const alloc = new anchor.BN(allocation);

  console.log({
    elapsed: elapsed.toString(),
    timeWindow: timeWindow.toString(),
    alloc: alloc.toString(),
    res: alloc.mul(elapsed).div(timeWindow).toString(),
  });

  return alloc.mul(elapsed).div(timeWindow).toNumber();
}

export async function getTokenBalanceOrZero(
  connection: anchor.web3.Connection,
  ata: anchor.web3.PublicKey,
): Promise<string> {
  try {
    return (await connection.getTokenAccountBalance(ata)).value.amount;
  } catch {
    return "0";
  }
}

export const getCurrentTimestamp = async (provider) => {
  const slot = await provider.connection.getSlot();
  const blockTime = await provider.connection.getBlockTime(slot);
  if (blockTime == null) {
    console.warn("getBlockTime returned null, using Date.now() fallback");
  }
  return blockTime ?? Math.floor(Date.now() / 1000);
};

export async function claimTokens(
  provider: anchor.AnchorProvider,
  proofs: number[][],
  userPk: anchor.web3.PublicKey,
  vaultPda: anchor.web3.PublicKey,
  program: anchor.Program<CapstoneEscrow>,
  mint: anchor.web3.PublicKey,
  signer: anchor.web3.Keypair,
  vaultAta: anchor.web3.PublicKey,
) {
  const [claimVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("claim_vault"), vaultPda.toBuffer(), userPk.toBuffer()],
    program.programId,
  );
  const userVaultAta = getAssociatedTokenAddressSync(mint, claimVaultPda, true);
  const userAta = getAssociatedTokenAddressSync(mint, userPk);

  // Pre-claim state
  const vault = await program.account.vault.fetch(vaultPda);
  const start = vault.startTimestamp.toNumber();
  const end = vault.endTimestamp.toNumber();
  const allocation = vault.userAllocation.toNumber();

  const initialUserBalance = await getTokenBalanceOrZero(
    provider.connection,
    userAta,
  );

  let amountClaimedSoFar = 0;
  try {
    const claimVault = await program.account.claimVault.fetch(claimVaultPda);
    amountClaimedSoFar = claimVault.amount.toNumber();
  } catch {
    // First claim – no claimVault yet
  }

  const now = await getCurrentTimestamp(provider);
  const vested = calculateExpectedVested(now, start, end, allocation);
  const expectedClaimAmount = new anchor.BN(vested)
    .sub(new anchor.BN(amountClaimedSoFar))
    .toNumber();

  // Exec
  await program.methods
    .claim(proofs)
    .accountsStrict({
      user: userPk,
      vault: vaultPda,
      userVault: claimVaultPda,
      userVaultAta,
      userAta,
      mintToClaim: mint,
      vaultAta,
      systemProgram: anchor.web3.SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .signers([signer])
    .rpc();

  // ─── 4. Post-claim verification ──────────────────────────────────────
  const finalUserBalance = (
    await provider.connection.getTokenAccountBalance(userAta)
  ).value.amount;

  const actualClaimed = new anchor.BN(finalUserBalance)
    .sub(new anchor.BN(initialUserBalance))
    .toNumber();

  console.log({
    amountClaimedSoFar,
    expectedClaimAmount,
    finalUserBalance,
    initialUserBalance,
    actualClaimed,
  });

  expect(actualClaimed).to.equal(
    expectedClaimAmount,
    `Expected claim ${expectedClaimAmount}, got ${actualClaimed}`,
  );

  // Full claim: claimVault + userVaultAta closed
  const claimVaultExists = !!(await provider.connection.getAccountInfo(
    claimVaultPda,
  ));
  if (claimVaultExists) {
    const claimVault = await program.account.claimVault.fetch(claimVaultPda);
    const userVaultBalance = await getTokenBalanceOrZero(
      provider.connection,
      userVaultAta,
    );
    expect(claimVault.amount.toNumber()).to.equal(Number(finalUserBalance));
    expect(Number(userVaultBalance) + Number(finalUserBalance)).to.equal(
      allocation,
    );
  } else {
    expect(finalUserBalance).to.equal(allocation.toString());
    const userVaultAtaInfo = await provider.connection.getAccountInfo(
      userVaultAta,
    );
    expect(userVaultAtaInfo).to.be.null;
  }

  return { userVaultAta, userAta, claimVaultPda };
}

export const warpToTimestamp = async (
  provider: anchor.AnchorProvider,
  timestampInMS: number,
) => {
  const response = await fetch(provider.connection.rpcEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "surfnet_timeTravel",
      params: [{ absoluteTimestamp: timestampInMS }],
    }),
  });
  const result: any = await response.json();
  if (result?.error) {
    throw new Error(result.error.message);
  }
  //   need to produce a block to confirm the time travel
  await provider.connection.requestAirdrop(provider.wallet.publicKey, 0);
  await new Promise((r) => setTimeout(r, 500));
  return result.result;
};
