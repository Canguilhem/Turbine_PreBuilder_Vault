import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CapstoneEscrow } from "../target/types/capstone_escrow";
import { expect } from "chai";
import {
  getAssociatedTokenAddressSync,
  createMint,
  mintTo,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { readFileSync } from "fs";
import { getCurrentTimestamp, warpToTimestamp } from "./helper";

// {
//     wl1: '4wQQJM9LNuhinieNAqmHuPCm8LXDTVfhx84P32nAVE9P',
//     wl2: 'H87xi4CUqrUPXzppV3jotTmre6DyR5pCaMk5bKQQBFTg',
//     creator: '3vQALgoWfBCHXVS9FTruSALzi9nkKkT55H6aKykiEYVU',
//     notWhitelisted: 'ErV63ApqLgh1Je5PdiVj6kzwkKJmLjKV41QoN9U4BNag'
//   }
const loadKeypairs = () => {
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

const getProofs = (merkleData: any, claimer: anchor.web3.PublicKey) => {
  const claimerKey = Object.keys(merkleData).find(
    (k) => k !== "merkleRoot" && k === claimer.toBase58().toLowerCase(),
  );
  const proofStrings = merkleData[claimerKey][0].proofs as string[];
  return proofStrings.map((p) => {
    const hex = p.startsWith("0x") ? p.slice(2) : p;
    const buf = Buffer.from(hex, "hex");
    return Array.from(buf) as number[];
  });
};

async function claimTokens(
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

  //   let amountClaimedSoFar = "0";

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

  console.log("balance check claim:", {
    userPk: userPk.toBase58(),
    now,
    start: vault.startTimestamp.toNumber(),
    end: vault.endTimestamp.toNumber(),
    allocation,
    vaultBalance,
    userVaultBalance,
    initialUserBalance,
    finalUserBalance,
  });

  return { userVaultAta, userAta, claimVaultPda };
}

const fundWallets = async (
  provider: anchor.AnchorProvider,
  wallets: anchor.web3.PublicKey[],
) => {
  await Promise.all(
    wallets.map(async (walletPk) => {
      provider.connection.requestAirdrop(
        walletPk,
        10 * anchor.web3.LAMPORTS_PER_SOL,
      );
    }),
  );
};

describe("capstone-escrow - localnet", () => {
  const provider = anchor.AnchorProvider.env();

  anchor.setProvider(provider);

  const program = anchor.workspace.capstoneEscrow as Program<CapstoneEscrow>;
  const maker = provider.wallet.publicKey;

  //   read private keys and get user public keys
  const {
    whitlisted1Keypair,
    whitlisted2Keypair,
    creatorKeypair,
    notWhitelistedKeypair,
  } = loadKeypairs();

  let mint: anchor.web3.PublicKey;
  let makerAta: anchor.web3.PublicKey;
  let vaultPda: anchor.web3.PublicKey;
  let vaultAta: anchor.web3.PublicKey;

  const seed = new anchor.BN(Date.now());
  const userAllocation = 1_000_000_000_000; // 1M base units (6 decimals)
  const depositAmount = userAllocation * 10; // enough for 10 users

  let now: number;
  let startTimestamp: anchor.BN;
  let endTimestamp: anchor.BN;
  // Schedule: start now, end in 30 days

  let merkleRoot: Buffer;
  let merkleData: any;

  before(async () => {
    now = await getCurrentTimestamp(provider);
    startTimestamp = new anchor.BN(now);
    endTimestamp = new anchor.BN(now + 30 * 24 * 60 * 60);

    // airdrop users
    await fundWallets(provider, [
      maker,
      whitlisted1Keypair.publicKey,
      whitlisted2Keypair.publicKey,
      creatorKeypair.publicKey,
      notWhitelistedKeypair.publicKey,
    ]);

    // Load merkle data from generated file
    merkleData = JSON.parse(
      readFileSync("utils/data/merkle_proofs.json", "utf8"),
    );
    merkleRoot = Buffer.from(merkleData.merkleRoot, "hex");
    if (merkleRoot.length !== 32) throw new Error("Invalid merkle root length");

    // Create mint (6 decimals)
    mint = await createMint(
      provider.connection,
      provider.wallet.payer,
      maker,
      null,
      6,
    );

    makerAta = getAssociatedTokenAddressSync(mint, maker);
    const makerAtaIx = createAssociatedTokenAccountInstruction(
      maker,
      makerAta,
      maker,
      mint,
    );
    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(makerAtaIx),
    );
    await mintTo(
      provider.connection,
      provider.wallet.payer,
      mint,
      makerAta,
      maker,
      depositAmount,
    );

    [vaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        maker.toBuffer(),
        seed.toArrayLike(Buffer, "le", 8),
      ],
      program.programId,
    );
    vaultAta = getAssociatedTokenAddressSync(mint, vaultPda, true);
  });

  it("Should successfully initialize vault and deposit tokens", async () => {
    await program.methods
      .initialize(
        seed,
        Array.from(merkleRoot),
        startTimestamp,
        endTimestamp,
        new anchor.BN(userAllocation),
        new anchor.BN(30 * 24 * 60 * 60),
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

    const vault = await program.account.vault.fetch(vaultPda);
    // confirm vault state
    expect(vault.merkleRoot).to.deep.equal(Array.from(merkleRoot));
    expect(vault.userAllocation.toNumber()).to.equal(userAllocation);
    expect(vault.startTimestamp.toNumber()).to.equal(startTimestamp.toNumber());
    expect(vault.endTimestamp.toNumber()).to.equal(endTimestamp.toNumber());
    expect(vault.seed.toNumber()).to.equal(seed.toNumber());
    expect(vault.maker.toBase58()).to.equal(maker.toBase58());
    expect(vault.tokenToClaim.toBase58()).to.equal(mint.toBase58());

    const vaultBalance = (
      await provider.connection.getTokenAccountBalance(vaultAta)
    ).value.amount;
    expect(vaultBalance).to.equal(depositAmount.toString());
  });

  it("test time travel", async () => {
    const before = await getCurrentTimestamp(provider);
    const after = before + 10000;
    await warpToTimestamp(provider, after * 1000);

    now = await getCurrentTimestamp(provider);
    expect(now).to.equal(after);
  });

  it("Successfully claim tokens with whitelisted address", async () => {
    const correctProofs = getProofs(merkleData, whitlisted1Keypair.publicKey);

    const wLUserPk = whitlisted1Keypair.publicKey;
    await claimTokens(
      provider,
      correctProofs,
      wLUserPk,
      vaultPda,
      program,
      mint,
      whitlisted1Keypair,
      vaultAta,
    );

    // jumping to end of schedule
    await warpToTimestamp(provider, (endTimestamp.toNumber() + 10) * 1000);

    // using incorrect proof on second claim shouldn't fail
    const incorrectProofs = getProofs(merkleData, whitlisted2Keypair.publicKey);

    await claimTokens(
      provider,
      incorrectProofs,
      wLUserPk,
      vaultPda,
      program,
      mint,
      whitlisted1Keypair,
      vaultAta,
    );

    await warpToTimestamp(provider, (endTimestamp.toNumber() + 100) * 1000);

    // User WL1 already claimed their full allocation, so claiming again should fail
    try {
      await claimTokens(
        provider,
        correctProofs,
        wLUserPk,
        vaultPda,
        program,
        mint,
        whitlisted1Keypair,
        vaultAta,
      );

      // If we reach here, the test should fail
      expect.fail("Expected transaction to fail, but it succeeded");
    } catch (error) {
      expect(error.toString()).to.include("InvalidAmount");
    }
  });

  it("Should fail when claiming with not whitelisted address", async () => {
    try {
      const incorrectProofs = getProofs(
        merkleData,
        whitlisted2Keypair.publicKey,
      );
      const userPk = notWhitelistedKeypair.publicKey;

      await claimTokens(
        provider,
        incorrectProofs,
        userPk,
        vaultPda,
        program,
        mint,
        notWhitelistedKeypair,
        vaultAta,
      );

      // If we reach here, the test should fail
      expect.fail("Expected transaction to fail, but it succeeded");
    } catch (err) {
      // Anchor error codes are usually here
      expect(err.toString()).to.include("InvalidProof");
    }
  });

  it("Should fail with invalid deposit", async () => {
    try {
      // mint more tokens to maker so he can deposit multiple times
      await mintTo(
        provider.connection,
        provider.wallet.payer,
        mint,
        makerAta,
        maker,
        depositAmount,
      );

      //   using new seed to initialize new vault
      const newSeed = seed.add(new anchor.BN(1));
      const [newVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("vault"),
          maker.toBuffer(),
          newSeed.toArrayLike(Buffer, "le", 8),
        ],
        program.programId,
      );
      const newVaultAta = getAssociatedTokenAddressSync(
        mint,
        newVaultPda,
        true,
      );

      await program.methods
        .initialize(
          newSeed,
          Array.from(merkleRoot),
          startTimestamp,
          endTimestamp,
          new anchor.BN(userAllocation),
          new anchor.BN(30 * 24 * 60 * 60),
          new anchor.BN(depositAmount + 1),
        )
        .accountsStrict({
          payer: maker,
          vault: newVaultPda,
          mintToClaim: mint,
          payerAta: makerAta,
          vaultAta: newVaultAta,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc();
      expect.fail("Expected transaction to fail, but it succeeded");
    } catch (err) {
      expect(err.toString()).to.include("InvalidDeposit");
    }
  });
});
