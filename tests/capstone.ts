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

import {
  checkSolBalance,
  claimTokens,
  fundWallets,
  getProofs,
  initVault,
  loadKeypairs,
  loadMerkleData,
} from "./helper";

describe("capstone-escrow initialize", () => {
  const provider = anchor.AnchorProvider.env();

  anchor.setProvider(provider);

  const program = anchor.workspace.capstoneEscrow as Program<CapstoneEscrow>;
  const maker = provider.wallet.publicKey;

  let mint: anchor.web3.PublicKey;
  let makerAta: anchor.web3.PublicKey;

  const { merkleRoot, merkleData } = loadMerkleData(
    "utils/data/merkle_proofs.json",
  );

  const userAllocation = new anchor.BN(1_000_000_000_000); // 1M base units (6 decimals)
  const depositAmount = userAllocation.mul(new anchor.BN(10)); // enough for 10 users

  const MIN_GRACE_PERIOD = new anchor.BN(7 * 24 * 60 * 60); // 7 days
  // const INVALID_GRACE_PERIOD = new anchor.BN(5 * 24 * 60 * 60); // 5days in prod
  const INVALID_GRACE_PERIOD = new anchor.BN(9); // 9 seconds for tests

  before(async () => {
    // airdrop users
    await fundWallets(provider, [maker]);

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

  it("Success - initialize vault and deposit tokens", async () => {
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

  it("Fail - invalid deposit", async () => {
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

  it("Fail - invalid grace period", async () => {
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
        INVALID_GRACE_PERIOD,
        depositAmount,
        maker,
        mint,
      );
      expect.fail("Expected transaction to fail, but it succeeded");
    } catch (err) {
      expect(err.toString()).to.include("InvalidClawbackPeriod");
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

  it("Success - Claim before start -> transfer to user_vault_ata", async () => {
    // Vault setup:
    const startDaysOffset = -1;
    const endDaysOffset = 11;

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
      "Before start",
    );
  });

  it("Success - elapsed: 10% claim w/ WL-1", async () => {
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
      "10% claim",
    );

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
      "10% claim + 5s",
    );
  });

  it("Success - elapsed: 50% claim w/ WL-1", async () => {
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
      "50% claim",
    );
  });

  it("Success - elapsed: 67% claim w/ WL-1", async () => {
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
      "67% claim",
    );
  });

  it("Success - elapsed: +100% claim w/ WL-1", async () => {
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
      "+100% claim",
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
        "already claimed everything",
      );

      // If we reach here, the test should fail
      expect.fail("Expected transaction to fail, but it succeeded");
    } catch (error) {
      expect(error.toString()).to.include("InvalidAmount");
    }
  });

  it("Fail - VaultNotActive", async () => {
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
        "Grace period ended",
      );

      // If we reach here, the test should fail
      expect.fail("Expected transaction to fail, but it succeeded");
    } catch (error) {
      expect(error.toString()).to.include("VaultNotActive");
    }
  });

  it("Fail - InvalidProof", async () => {
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
        "Not whitelisted",
      );

      // If we reach here, the test should fail
      expect.fail("Expected transaction to fail, but it succeeded");
    } catch (err) {
      expect(err.toString()).to.include("InvalidProof");
    }
  });
});

describe("Clawback tokens && close vault", () => {
  const provider = anchor.AnchorProvider.env();

  anchor.setProvider(provider);

  const program = anchor.workspace.capstoneEscrow as Program<CapstoneEscrow>;
  const maker = provider.wallet.publicKey;

  //   read private keys and get user public keys
  const { whitlisted1Keypair } = loadKeypairs();

  let mint: anchor.web3.PublicKey;
  let makerAta: anchor.web3.PublicKey;

  const { merkleRoot, merkleData } = loadMerkleData(
    "utils/data/merkle_proofs.json",
  );

  const correctProofs = getProofs(merkleData, whitlisted1Keypair.publicKey);

  const userAllocation = new anchor.BN(1_000_000_000_000); // 1M base units (6 decimals)
  const depositAmount = userAllocation.mul(new anchor.BN(10)); // enough for 10 users
  // const MIN_GRACE_PERIOD = new anchor.BN(7 * 24 * 60 * 60); // 7 days in prod
  const MIN_GRACE_PERIOD = new anchor.BN(10); // 9 seconds for tests

  before(async () => {
    // airdrop users
    await fundWallets(provider, [maker, whitlisted1Keypair.publicKey]);
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

  it("Success - Clawback tokens when user vault exists", async () => {
    // Vault setup:
    const SEC_PER_DAY = 24 * 60 * 60;

    // start 10 days ago, end in 5 seconds
    const startDaysOffset = 10;
    const endDaysOffset = 5 / SEC_PER_DAY;

    const { vaultPda, vaultAta } = await initVault(
      provider,
      startDaysOffset,
      endDaysOffset,
      makerAta,
      program,
      merkleRoot,
      userAllocation,
      MIN_GRACE_PERIOD, // 10 seconds
      depositAmount,
      maker,
      mint,
    );

    const wLUserPk = whitlisted1Keypair.publicKey;
    const { claimVaultPda, userVaultAta } = await claimTokens(
      provider,
      correctProofs,
      wLUserPk,
      vaultPda,
      program,
      mint,
      whitlisted1Keypair,
      vaultAta,
      "Just before end",
    );

    // wait 12 seconds to ensure grace period ended
    await new Promise((r) => setTimeout(r, 18000));

    const claimVaultBalanceBefore = (
      await provider.connection.getTokenAccountBalance(userVaultAta)
    ).value.amount;
    const vaultAtaBalanceBefore = (
      await provider.connection.getTokenAccountBalance(vaultAta)
    ).value.amount;

    await program.methods
      .clawback()
      .accountsStrict({
        maker,
        vault: vaultPda,
        mintToClaim: mint,
        user: wLUserPk,
        userVault: claimVaultPda,
        userVaultAta: userVaultAta,
        vaultAta,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    try {
      // PDA should be closed
      const claimVault = await provider.connection.getAccountInfo(
        claimVaultPda,
      );
      expect(claimVault).to.be.null;

      // ATA should be closed
      const userVaultAtaInfo = await provider.connection.getAccountInfo(
        userVaultAta,
      );
      expect(userVaultAtaInfo).to.be.null;

      // remaining tokens should be sent back to vault_ata
      const vaultAtaBalanceAfter = (
        await provider.connection.getTokenAccountBalance(vaultAta)
      ).value.amount;
      expect(vaultAtaBalanceAfter).to.equal(
        new anchor.BN(vaultAtaBalanceBefore)
          .add(new anchor.BN(claimVaultBalanceBefore))
          .toString(),
      );
    } catch (err) {
      console.log(err.toString());
      expect.fail("Expected transaction to fail, but it succeeded");
    }
  });

  it("Success - Close vault", async () => {
    // Vault setup:
    const SEC_PER_DAY = 24 * 60 * 60;

    // start 10 days ago, end in 5 seconds
    const startDaysOffset = 10;
    const endDaysOffset = 5 / SEC_PER_DAY;

    const { vaultPda, vaultAta } = await initVault(
      provider,
      startDaysOffset,
      endDaysOffset,
      makerAta,
      program,
      merkleRoot,
      userAllocation,
      MIN_GRACE_PERIOD, // 10 seconds
      depositAmount,
      maker,
      mint,
    );

    // wait 12 seconds to ensure grace period ended
    await new Promise((r) => setTimeout(r, 18000));

    await program.methods
      .closeVault()
      .accountsStrict({
        maker,
        vault: vaultPda,
        mintToClaim: mint,
        makerAta,
        vaultAta,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    // account should be closed
    const vault = await provider.connection.getAccountInfo(vaultPda);
    expect(vault).to.be.null;

    // tokens should be sent back to maker
    const makerAtaBalance = (
      await provider.connection.getTokenAccountBalance(makerAta)
    ).value.amount;
    expect(makerAtaBalance).to.equal(depositAmount.toString());
  });

  it("Fail - user vault doesnt exists", async () => {
    // Vault setup:
    const SEC_PER_DAY = 24 * 60 * 60;

    // start 10 days ago, end in 5 seconds
    const startDaysOffset = 10;
    const endDaysOffset = 5 / SEC_PER_DAY;

    const { vaultPda, vaultAta } = await initVault(
      provider,
      startDaysOffset,
      endDaysOffset,
      makerAta,
      program,
      merkleRoot,
      userAllocation,
      MIN_GRACE_PERIOD, // 10 seconds
      depositAmount,
      maker,
      mint,
    );

    const wLUserPk = whitlisted1Keypair.publicKey;

    // wait 12 seconds to ensure grace period ended
    await new Promise((r) => setTimeout(r, 18000));

    // user never claimed tokens -> user vault doesnt exist
    const [claimVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("claim_vault"), vaultPda.toBuffer(), wLUserPk.toBuffer()],
      program.programId,
    );
    const userVaultAta = getAssociatedTokenAddressSync(
      mint,
      claimVaultPda,
      true,
    );

    try {
      await program.methods
        .clawback()
        .accountsStrict({
          maker,
          vault: vaultPda,
          mintToClaim: mint,
          user: wLUserPk,
          userVault: claimVaultPda,
          userVaultAta: userVaultAta,
          vaultAta,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc();
      expect.fail("Expected transaction to fail, but it succeeded");
    } catch (err) {
      expect(err.toString()).to.include(
        "expected this account to be already initialized",
      );
    }
  });

  it("Fail - Clawback by non-maker", async () => {
    // Vault setup:
    const SEC_PER_DAY = 24 * 60 * 60;

    // start 10 days ago, end in 5 seconds
    const startDaysOffset = 10;
    const endDaysOffset = 5 / SEC_PER_DAY;

    const { vaultPda, vaultAta } = await initVault(
      provider,
      startDaysOffset,
      endDaysOffset,
      makerAta,
      program,
      merkleRoot,
      userAllocation,
      MIN_GRACE_PERIOD, // 10 seconds
      depositAmount,
      maker,
      mint,
    );

    const wLUserPk = whitlisted1Keypair.publicKey;
    const { claimVaultPda, userVaultAta } = await claimTokens(
      provider,
      correctProofs,
      wLUserPk,
      vaultPda,
      program,
      mint,
      whitlisted1Keypair,
      vaultAta,
      "Just before end",
    );

    // wait 12 seconds to ensure grace period ended
    await new Promise((r) => setTimeout(r, 18000));

    try {
      await program.methods
        .clawback()
        .accountsStrict({
          maker: wLUserPk,
          vault: vaultPda,
          mintToClaim: mint,
          user: wLUserPk,
          userVault: claimVaultPda,
          userVaultAta: userVaultAta,
          vaultAta,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([whitlisted1Keypair])
        .rpc();
      expect.fail("Expected transaction to fail, but it succeeded");
    } catch (err) {
      // ConstraintSeeds or ConstraintKey
      expect(err.toString()).to.include("Constraint");
    }
  });

  it("Fail - Close vault by non-maker", async () => {
    // Vault setup:
    const SEC_PER_DAY = 24 * 60 * 60;

    // start 10 days ago, end in 5 seconds
    const startDaysOffset = 10;
    const endDaysOffset = 5 / SEC_PER_DAY;

    const { vaultPda, vaultAta } = await initVault(
      provider,
      startDaysOffset,
      endDaysOffset,
      makerAta,
      program,
      merkleRoot,
      userAllocation,
      MIN_GRACE_PERIOD, // 10 seconds
      depositAmount,
      maker,
      mint,
    );

    const wLUserPk = whitlisted1Keypair.publicKey;
    const wl1Ata = getAssociatedTokenAddressSync(mint, wLUserPk);
    const createAtaIx = createAssociatedTokenAccountInstruction(
      wLUserPk,
      wl1Ata,
      wLUserPk,
      mint,
    );
    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(createAtaIx),
      [whitlisted1Keypair],
    );

    // wait 12 seconds to ensure grace period ended
    await new Promise((r) => setTimeout(r, 18000));

    try {
      await program.methods
        .closeVault()
        .accountsStrict({
          maker: wLUserPk,
          vault: vaultPda,
          mintToClaim: mint,
          makerAta: wl1Ata,
          vaultAta,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([whitlisted1Keypair])
        .rpc();
      expect.fail("Expected transaction to fail, but it succeeded");
    } catch (err) {
      // ConstraintSeeds or ConstraintKey
      expect(err.toString()).to.include("Constraint");
    }
  });

  it("Fail - GracePeriodNotEnded", async () => {
    // Vault setup:
    const SEC_PER_DAY = 24 * 60 * 60;

    // start 10 days ago, end in 5 seconds
    const startDaysOffset = 10;
    const endDaysOffset = 5 / SEC_PER_DAY;

    const { vaultPda, vaultAta } = await initVault(
      provider,
      startDaysOffset,
      endDaysOffset,
      makerAta,
      program,
      merkleRoot,
      userAllocation,
      MIN_GRACE_PERIOD, // 10 seconds
      depositAmount,
      maker,
      mint,
    );

    const wLUserPk = whitlisted1Keypair.publicKey;
    const { claimVaultPda, userVaultAta } = await claimTokens(
      provider,
      correctProofs,
      wLUserPk,
      vaultPda,
      program,
      mint,
      whitlisted1Keypair,
      vaultAta,
      "Just before end",
    );

    // wait 12 seconds to ensure grace period ended
    await new Promise((r) => setTimeout(r, 10000));

    try {
      await program.methods
        .clawback()
        .accountsStrict({
          maker,
          vault: vaultPda,
          mintToClaim: mint,
          user: wLUserPk,
          userVault: claimVaultPda,
          userVaultAta: userVaultAta,
          vaultAta,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc();
      expect.fail("Expected transaction to fail, but it succeeded");
    } catch (err) {
      expect(err.toString()).to.include("GracePeriodNotEnded");
    }
  });
});
