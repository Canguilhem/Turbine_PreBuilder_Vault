import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CapstoneEscrow } from "../target/types/capstone_escrow";
import { expect } from "chai";
import {
  getAssociatedTokenAddressSync,
  createMint,
  mintTo,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";

import {
  claimTokens,
  fundWallets,
  getCurrentTimestamp,
  getProofs,
  initVault,
  loadKeypairs,
  loadMerkleData,
} from "./helper";

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

  const { merkleRoot, merkleData } = loadMerkleData(
    "utils/data/merkle_proofs.json",
  );

  const userAllocation = new anchor.BN(1_000_000_000_000); // 1M base units (6 decimals)
  const depositAmount = userAllocation.mul(new anchor.BN(10)); // enough for 10 users

  const MIN_GRACE_PERIOD = new anchor.BN(7 * 24 * 60 * 60);

  before(async () => {
    // airdrop users
    await fundWallets(provider, [
      maker,
      whitlisted1Keypair.publicKey,
      whitlisted2Keypair.publicKey,
      creatorKeypair.publicKey,
      notWhitelistedKeypair.publicKey,
    ]);

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
      depositAmount.toNumber() * 3, //enough to initialize 3 vaults
    );
  });

  it("Should successfully initialize vault and deposit tokens", async () => {
    // Vault setup:
    const startDaysOffset = 20;
    const endDaysOffset = 30;

    const { vaultPda, vaultAta, seed, startTimestamp, endTimestamp } =
      await initVault(
        provider,
        startDaysOffset,
        endDaysOffset,
        makerAta,
        program,
        merkleRoot,
        userAllocation,
        MIN_GRACE_PERIOD,
        depositAmount,
        maker,
        mint,
      );

    const vault = await program.account.vault.fetch(vaultPda);

    // confirm vault state
    expect(vault.merkleRoot).to.deep.equal(Array.from(merkleRoot));
    expect(vault.userAllocation.toNumber()).to.equal(userAllocation.toNumber());
    expect(vault.startTimestamp.toNumber()).to.equal(startTimestamp.toNumber());
    expect(vault.endTimestamp.toNumber()).to.equal(endTimestamp.toNumber());
    expect(vault.seed.toNumber()).to.equal(seed.toNumber());
    expect(vault.maker.toBase58()).to.equal(maker.toBase58());
    expect(vault.tokenToClaim.toBase58()).to.equal(mint.toBase58());
    expect(vault.gracePeriod.toNumber()).to.equal(MIN_GRACE_PERIOD.toNumber());

    const vaultBalance = (
      await provider.connection.getTokenAccountBalance(vaultAta)
    ).value.amount;
    expect(vaultBalance).to.equal(depositAmount.toString());
  });

  // it("Should successfully clawback tokens", async () => {
  //   const jumpToTimestamp = endTimestamp
  //     .add(MIN_GRACE_PERIOD)
  //     .add(new anchor.BN(10))
  //     .mul(new anchor.BN(1000))
  //     .toNumber();
  //   await warpToTimestamp(provider, jumpToTimestamp);
  //   now = await getCurrentTimestamp(provider);
  //   // expect(now * 1000).to.equal(jumpToTimestamp);

  //   const [claimVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
  //     [
  //       Buffer.from("claim_vault"),
  //       vaultPda.toBuffer(),
  //       whitlisted2Keypair.publicKey.toBuffer(),
  //     ],
  //     program.programId,
  //   );
  //   const userVaultAta = getAssociatedTokenAddressSync(
  //     mint,
  //     claimVaultPda,
  //     true,
  //   );
  //   try {
  //     await program.methods
  //       .clawback()
  //       .accountsStrict({
  //         maker,
  //         vault: vaultPda,
  //         mintToClaim: mint,
  //         user: whitlisted2Keypair.publicKey,
  //         userVault: claimVaultPda,
  //         userVaultAta: userVaultAta,
  //         vaultAta,
  //         systemProgram: anchor.web3.SystemProgram.programId,
  //         tokenProgram: TOKEN_PROGRAM_ID,
  //         associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  //       })
  //       .rpc();
  //   } catch (err) {
  //     console.log(err.toString());
  //   }
  // });

  it("Should fail to initialize new vault with invalid deposit", async () => {
    try {
      // Vault setup:
      const startDaysOffset = 20;
      const endDaysOffset = 30;

      await initVault(
        provider,
        startDaysOffset,
        endDaysOffset,
        makerAta,
        program,
        merkleRoot,
        userAllocation.add(new anchor.BN(1)),
        MIN_GRACE_PERIOD,
        depositAmount,
        maker,
        mint,
      );
      expect.fail("Expected transaction to fail, but it succeeded");
    } catch (err) {
      expect(err.toString()).to.include("InvalidDeposit");
    }
  });
});

describe("Claim tokens at diffrent times", () => {
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

  const { merkleRoot, merkleData } = loadMerkleData(
    "utils/data/merkle_proofs.json",
  );

  //  valid proofs for wl-2 we'll use with another user
  const incorrectProofs = getProofs(merkleData, whitlisted2Keypair.publicKey);

  const correctProofs = getProofs(merkleData, whitlisted1Keypair.publicKey);

  const userAllocation = new anchor.BN(1_000_000_000_000); // 1M base units (6 decimals)
  const depositAmount = userAllocation.mul(new anchor.BN(10)); // enough for 10 users
  const MIN_GRACE_PERIOD = new anchor.BN(7 * 24 * 60 * 60);

  before(async () => {
    // airdrop users
    await fundWallets(provider, [
      maker,
      whitlisted1Keypair.publicKey,
      whitlisted2Keypair.publicKey,
      creatorKeypair.publicKey,
      notWhitelistedKeypair.publicKey,
    ]);
  });

  // use new mint for each token so our claim amount comparisons are accurate
  beforeEach(async () => {
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
      depositAmount.toNumber(),
    );
  });

  it("Success elapsed: 10% claim w/ WL-1", async () => {
    // Vault setup:
    const startDaysOffset = 1;
    const endDaysOffset = 9;

    const { vaultPda, vaultAta } = await initVault(
      provider,
      startDaysOffset,
      endDaysOffset,
      makerAta,
      program,
      merkleRoot,
      userAllocation,
      MIN_GRACE_PERIOD,
      depositAmount,
      maker,
      mint,
    );

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
    // await warpToTimestamp(provider, (endTimestamp.toNumber() + 10) * 1000);
    await new Promise((r) => setTimeout(r, 5000));

    // using incorrect proof on second claim shouldn't fail
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
  });

  it("Success elapsed: 50% claim w/ WL-1", async () => {
    // Vault setup:
    const startDaysOffset = 15;
    const endDaysOffset = 15;

    const { vaultPda, vaultAta } = await initVault(
      provider,
      startDaysOffset,
      endDaysOffset,
      makerAta,
      program,
      merkleRoot,
      userAllocation,
      MIN_GRACE_PERIOD,
      depositAmount,
      maker,
      mint,
    );

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
  });

  it("Success elapsed: 67% claim w/ WL-1", async () => {
    // Vault setup:
    const startDaysOffset = 20;
    const endDaysOffset = 10;

    const { vaultPda, vaultAta } = await initVault(
      provider,
      startDaysOffset,
      endDaysOffset,
      makerAta,
      program,
      merkleRoot,
      userAllocation,
      MIN_GRACE_PERIOD,
      depositAmount,
      maker,
      mint,
    );

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
  });

  it("Success elapsed: +100% claim w/ WL-1", async () => {
    // Vault setup:
    const startDaysOffset = 20;
    const endDaysOffset = -1;

    const { vaultPda, vaultAta } = await initVault(
      provider,
      startDaysOffset,
      endDaysOffset,
      makerAta,
      program,
      merkleRoot,
      userAllocation,
      MIN_GRACE_PERIOD,
      depositAmount,
      maker,
      mint,
    );

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

  it("Fail when claiming once grace period ended", async () => {
    // Vault setup:
    const startDaysOffset = 20;
    const endDaysOffset = -7.1;

    const { vaultPda, vaultAta } = await initVault(
      provider,
      startDaysOffset,
      endDaysOffset,
      makerAta,
      program,
      merkleRoot,
      userAllocation,
      MIN_GRACE_PERIOD,
      depositAmount,
      maker,
      mint,
    );

    const wLUserPk = whitlisted1Keypair.publicKey;
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
      expect(error.toString()).to.include("VaultNotActive");
    }
  });

  it("Fail when claiming with not whitelisted address", async () => {
    try {
      // Vault setup:
      const startDaysOffset = 20;
      const endDaysOffset = 20;

      const { vaultPda, vaultAta } = await initVault(
        provider,
        startDaysOffset,
        endDaysOffset,
        makerAta,
        program,
        merkleRoot,
        userAllocation,
        MIN_GRACE_PERIOD,
        depositAmount,
        maker,
        mint,
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
      expect(err.toString()).to.include("InvalidProof");
    }
  });
});
