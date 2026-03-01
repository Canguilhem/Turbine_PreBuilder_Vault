import * as anchor from "@coral-xyz/anchor";
import { CapstoneEscrow } from "../target/types/capstone_escrow";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { expect } from "chai";
import { readFileSync } from "fs";

export const getCurrentTimestamp = async (provider) => {
  const slot = await provider.connection.getSlot();
  const blockTime = await provider.connection.getBlockTime(slot);
  if (blockTime == null) {
    console.warn("getBlockTime returned null, using Date.now() fallback");
  }
  return blockTime ?? Math.floor(Date.now() / 1000);
};

// {
//     wl1: '4wQQJM9LNuhinieNAqmHuPCm8LXDTVfhx84P32nAVE9P',
//     wl2: 'H87xi4CUqrUPXzppV3jotTmre6DyR5pCaMk5bKQQBFTg',
//     creator: '3vQALgoWfBCHXVS9FTruSALzi9nkKkT55H6aKykiEYVU',
//     notWhitelisted: 'ErV63ApqLgh1Je5PdiVj6kzwkKJmLjKV41QoN9U4BNag'
//   }
export const loadKeypairs = () => {
  const whitlisted1 = JSON.parse(
    readFileSync("keypairs/whitelisted_1.json", "utf8"),
  );
  const whitlisted1Keypair = anchor.web3.Keypair.fromSecretKey(
    Uint8Array.from(whitlisted1),
  );

  const whitlisted2 = JSON.parse(
    readFileSync("keypairs/whitelisted_2.json", "utf8"),
  );
  const whitlisted2Keypair = anchor.web3.Keypair.fromSecretKey(
    Uint8Array.from(whitlisted2),
  );

  const creator = JSON.parse(readFileSync("keypairs/creator.json", "utf8"));
  const creatorKeypair = anchor.web3.Keypair.fromSecretKey(
    Uint8Array.from(creator),
  );

  const notWhitelisted = JSON.parse(
    readFileSync("keypairs/not_whitelisted.json", "utf8"),
  );
  const notWhitelistedKeypair = anchor.web3.Keypair.fromSecretKey(
    Uint8Array.from(notWhitelisted),
  );

  return {
    whitlisted1Keypair,
    whitlisted2Keypair,
    creatorKeypair,
    notWhitelistedKeypair,
  };
};

export const getProofs = (merkleData: any, claimer: anchor.web3.PublicKey) => {
  const claimerKey = Object.keys(merkleData).find(
    (k) => k !== "merkleRoot" && k === claimer.toBase58().toLowerCase(),
  );

  if (!claimerKey) {
    // return random proofs
    return Array.from({ length: 2 }, () =>
      Array.from({ length: 33 }, () => Math.floor(Math.random() * 256)),
    );
  }

  const proofStrings = merkleData[claimerKey][0].proofs as string[];
  return proofStrings.map((p) => {
    const hex = p.startsWith("0x") ? p.slice(2) : p;
    const buf = Buffer.from(hex, "hex");
    return Array.from(buf) as number[];
  });
};

export const loadMerkleData = (filePath: string) => {
  const merkleData = JSON.parse(readFileSync(filePath, "utf8"));
  const merkleRoot = Buffer.from(merkleData.merkleRoot, "hex");
  if (merkleRoot.length !== 32) throw new Error("Invalid merkle root length");
  return { merkleData, merkleRoot };
};

export const initVault = async (
  provider: anchor.AnchorProvider,
  startDaysOffset: number,
  endDaysOffset: number,
  makerAta: anchor.web3.PublicKey,
  program: anchor.Program<CapstoneEscrow>,
  merkleRoot: Buffer,
  userAllocation: anchor.BN,
  gracePeriod: anchor.BN,
  depositAmount: anchor.BN,
  maker: anchor.web3.PublicKey,
  mint: anchor.web3.PublicKey,
) => {
  const seed = new anchor.BN(Math.floor(Math.random() * 1000000));
  const now = await getCurrentTimestamp(provider);
  const startTimestamp = new anchor.BN(now).sub(
    new anchor.BN(60 * 60 * 24 * startDaysOffset),
  );
  const endTimestamp = new anchor.BN(now).add(
    new anchor.BN(60 * 60 * 24 * endDaysOffset),
  );

  const [vaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), maker.toBuffer(), seed.toArrayLike(Buffer, "le", 8)],
    program.programId,
  );
  const vaultAta = getAssociatedTokenAddressSync(mint, vaultPda, true);

  await program.methods
    .initialize(
      seed,
      Array.from(merkleRoot),
      startTimestamp,
      endTimestamp,
      new anchor.BN(userAllocation),
      new anchor.BN(gracePeriod),
      new anchor.BN(depositAmount),
    )
    .accountsStrict({
      payer: maker,
      vault: vaultPda,
      mintToClaim: mint,
      payerAta: makerAta,
      vaultAta,
      systemProgram: anchor.web3.SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc();

  return { vaultPda, vaultAta, seed, startTimestamp, endTimestamp };
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
  testName: string,
) {
  const [claimVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("claim_vault"), vaultPda.toBuffer(), userPk.toBuffer()],
    program.programId,
  );
  const userVaultAta = getAssociatedTokenAddressSync(mint, claimVaultPda, true);
  const userAta = getAssociatedTokenAddressSync(mint, userPk);
  //   vault state
  const vault = await program.account.vault.fetch(vaultPda);
  const allocation = vault.userAllocation.toNumber();

  //   get initial user balance
  let initialUserBalance = "0";
  try {
    initialUserBalance = (
      await provider.connection.getTokenAccountBalance(userAta)
    ).value.amount;
  } catch (error) {
    // ATA doesnt exist yet
  }

  let now = await getCurrentTimestamp(provider);

  await program.methods
    .claim(proofs)
    .accountsStrict({
      user: userPk,
      vault: vaultPda,
      userVault: claimVaultPda,
      userVaultAta: userVaultAta,
      userAta: userAta,
      mintToClaim: mint,
      vaultAta,
      systemProgram: anchor.web3.SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .signers([signer])
    .rpc();

  //   balances check - if all allocated tokens are claimed, accounts will be closed
  let userVaultBalance: string | null = null;
  let claimVault: any;

  const finalUserBalance = (
    await provider.connection.getTokenAccountBalance(userAta)
  ).value.amount;

  const vaultBalance = (
    await provider.connection.getTokenAccountBalance(vaultAta)
  ).value.amount;

  const userVaultInfo = await provider.connection.getAccountInfo(userVaultAta);
  if (userVaultInfo) {
    userVaultBalance = (
      await provider.connection.getTokenAccountBalance(userVaultAta)
    ).value.amount;
  }

  const claimVaultInfo = await provider.connection.getAccountInfo(
    claimVaultPda,
  );
  if (claimVaultInfo) {
    claimVault = await program.account.claimVault.fetch(claimVaultPda);
    // assuming no transfers from userATA: finalUserBalance should equal claimVault.amount
    expect(finalUserBalance).to.equal(claimVault.amount.toString());

    const totalBalance = new anchor.BN(userVaultBalance).add(
      new anchor.BN(finalUserBalance),
    );
    // userVaultBalance balance + userBalance should equal token allocation
    expect(totalBalance.toNumber()).to.equal(allocation);
  } else {
    // assuming no transfers from userATA: finalUserBalance should equal allocation
    expect(finalUserBalance).to.equal(allocation.toString());
    // userVaultAta should be closed
    const userVaultAtaInfo = await provider.connection.getAccountInfo(
      userVaultAta,
    );
    // userVaultAta should be closed
    expect(userVaultAtaInfo).to.be.null;
  }

  const elapsed = now - vault.startTimestamp.toNumber();
  const timeWindow =
    vault.endTimestamp.toNumber() - vault.startTimestamp.toNumber();
  const elapsedPercentage = Math.round((elapsed / timeWindow) * 10000) / 100;
  const claimedAmount = new anchor.BN(finalUserBalance).sub(
    new anchor.BN(initialUserBalance),
  );

  // console.log(
  //   `elapsed: ${elapsedPercentage}% | vaultBalance: ${formatTokens(
  //     vaultBalance,
  //   )} | unvested: ${formatTokens(userVaultBalance)} | % claimed: ${
  //     Math.round((Number(finalUserBalance) / allocation) * 10000) / 100
  //   }% | claimedThisRound: ${formatTokens(claimedAmount.toString())}`,
  // );

  return { userVaultAta, userAta, claimVaultPda };
}

export const fundWallets = async (
  provider: anchor.AnchorProvider,
  wallets: anchor.web3.PublicKey[],
) => {
  if (!provider.connection.rpcEndpoint.includes("devnet")) {
    await Promise.all(
      wallets.map(async (walletPk) => {
        provider.connection.requestAirdrop(
          walletPk,
          10 * anchor.web3.LAMPORTS_PER_SOL,
        );
      }),
    );
  }
  // await checkSolBalance(provider, wallets, 9);
};

const formatTokens = (amount: string, decimals = 6) =>
  (Number(amount) / 10 ** decimals).toLocaleString();

export const checkSolBalance = async (
  provider: anchor.AnchorProvider,
  pubKeys: anchor.web3.PublicKey[],
  decimals = 9,
) => {
  for (const walletPk of pubKeys) {
    const balance = await provider.connection.getBalance(walletPk);
    console.log(
      `${walletPk.toBase58().slice(0, 6)} balance: ${formatTokens(
        balance.toString(),
        decimals,
      )}`,
    );
  }
};
