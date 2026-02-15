import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SimpleEscrow } from "../target/types/simple_escrow";
import { expect } from "chai";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createMint,
  mintTo,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

describe("simple_escrow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.simpleEscrow as Program<SimpleEscrow>;

  const maker = provider.wallet.publicKey;
  const taker = anchor.web3.Keypair.generate();

  let mintA: anchor.web3.PublicKey;
  let mintB: anchor.web3.PublicKey;
  let makerAtaA: anchor.web3.PublicKey;
  let takerAtaB: anchor.web3.PublicKey;
  let makerAtaB: anchor.web3.PublicKey;
  let takerAtaA: anchor.web3.PublicKey;

  const seed = new anchor.BN(1234);
  let escrowPda: anchor.web3.PublicKey;
  let escrowBump: number;
  let vault: anchor.web3.PublicKey;

  const depositAmount = 100;
  const receiveAmount = 200;

  before(async () => {
    // Airdrop SOL to maker and taker
    await provider.connection.requestAirdrop(
      maker,
      10 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await provider.connection.requestAirdrop(
      taker.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Create mints (decimals=0 for simplicity)
    mintA = await createMint(
      provider.connection,
      provider.wallet.payer,
      maker,
      null,
      0,
    );
    mintB = await createMint(
      provider.connection,
      provider.wallet.payer,
      taker.publicKey,
      null,
      0,
    );

    // Create ATAs and mint tokens
    makerAtaA = getAssociatedTokenAddressSync(mintA, maker);
    const makerAtaATx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        provider.wallet.publicKey,
        makerAtaA,
        maker,
        mintA,
      ),
    );
    await provider.sendAndConfirm(makerAtaATx);
    await mintTo(
      provider.connection,
      provider.wallet.payer,
      mintA,
      makerAtaA,
      provider.wallet.payer,
      depositAmount * 2,
    );

    takerAtaB = getAssociatedTokenAddressSync(mintB, taker.publicKey);
    const takerAtaBTx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        taker.publicKey,
        takerAtaB,
        taker.publicKey,
        mintB,
      ),
    );
    await provider.sendAndConfirm(takerAtaBTx, [taker]);
    await mintTo(
      provider.connection,
      taker,
      mintB,
      takerAtaB,
      taker,
      receiveAmount * 2,
    );
  });

  it("Makes and refunds the escrow", async () => {
    const seed1 = new anchor.BN(1111);
    [escrowPda, escrowBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        maker.toBuffer(),
        seed1.toArrayLike(Buffer, "le", 8),
      ],
      program.programId,
    );
    vault = getAssociatedTokenAddressSync(mintA, escrowPda, true);

    // Make
    await program.methods
      .make(seed1, new anchor.BN(depositAmount), new anchor.BN(receiveAmount))
      .accountsStrict({
        maker: maker,
        mintA: mintA,
        mintB: mintB,
        makerAtaA: makerAtaA,
        escrow: escrowPda,
        vault: vault,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const escrowAccount = await program.account.escrow.fetch(escrowPda);
    expect(escrowAccount.maker.toBase58()).to.equal(maker.toBase58());
    expect(escrowAccount.mintA.toBase58()).to.equal(mintA.toBase58());
    expect(escrowAccount.mintB.toBase58()).to.equal(mintB.toBase58());
    expect(escrowAccount.receive.toNumber()).to.equal(receiveAmount);
    expect(escrowAccount.bump).to.equal(escrowBump);

    const vaultBalance = (
      await provider.connection.getTokenAccountBalance(vault)
    ).value.uiAmount;
    expect(vaultBalance).to.equal(depositAmount);

    // Refund
    await program.methods
      .refund()
      .accountsStrict({
        maker: maker,
        mintA: mintA,
        makerAtaA: makerAtaA,
        escrow: escrowPda,
        vault: vault,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Check closed
    const escrowInfo = await provider.connection.getAccountInfo(escrowPda);
    expect(escrowInfo).to.be.null;

    const vaultInfo = await provider.connection.getAccountInfo(vault);
    expect(vaultInfo).to.be.null;
  });

  it("Makes and takes the escrow", async () => {
    const seed2 = new anchor.BN(2222);
    [escrowPda, escrowBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        maker.toBuffer(),
        seed2.toArrayLike(Buffer, "le", 8),
      ],
      program.programId,
    );
    vault = getAssociatedTokenAddressSync(mintA, escrowPda, true);

    // Make (again for take path)
    await program.methods
      .make(seed2, new anchor.BN(depositAmount), new anchor.BN(receiveAmount))
      .accountsStrict({
        maker: maker,
        mintA: mintA,
        mintB: mintB,
        makerAtaA: makerAtaA,
        escrow: escrowPda,
        vault: vault,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Setup for take
    takerAtaA = getAssociatedTokenAddressSync(mintA, taker.publicKey);
    makerAtaB = getAssociatedTokenAddressSync(mintB, maker);

    // console.log("Balances :", {
    //   makerBalanceA: (
    //     await provider.connection.getTokenAccountBalance(makerAtaA)
    //   ).value.uiAmount,
    //   makerBalanceB: (
    //     await provider.connection.getTokenAccountBalance(makerAtaB)
    //   ).value.uiAmount,
    //   takerBalanceA: (
    //     await provider.connection.getTokenAccountBalance(takerAtaA)
    //   ).value.uiAmount,
    //   takerBalanceB: (
    //     await provider.connection.getTokenAccountBalance(takerAtaB)
    //   ).value.uiAmount,
    // });

    // console.log("takerAtaA:", takerAtaA.toBase58());
    // console.log("makerAtaB:", makerAtaB.toBase58());

    // takerAtaB = getAssociatedTokenAddressSync(mintB, taker.publicKey);
    // makerAtaA = getAssociatedTokenAddressSync(mintA, maker);
    // console.log("takerAtaB:", takerAtaB.toBase58());
    // console.log("makerAtaA:", makerAtaA.toBase58());

    // console.log("take setup: ", {
    //   taker: taker.publicKey.toBase58(),
    //   maker: maker.toBase58(),
    //   mintA: mintA.toBase58(),
    //   mintB: mintB.toBase58(),
    //   takerAtaA: takerAtaA.toBase58(),
    //   takerAtaB: takerAtaB.toBase58(),
    //   makerAtaB: makerAtaB.toBase58(),
    //   escrow: escrowPda.toBase58(),
    //   vault: vault.toBase58(),
    //   associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
    //   tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
    //   systemProgram: anchor.web3.SystemProgram.programId,
    // });

    // Take
    await program.methods
      .take()
      .accountsStrict({
        taker: taker.publicKey,
        maker: maker,
        mintA: mintA,
        mintB: mintB,
        takerAtaA: takerAtaA,
        takerAtaB: takerAtaB,
        makerAtaB: makerAtaB,
        escrow: escrowPda,
        vault: vault,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([taker])
      .rpc();

    // Check closed
    const escrowInfo = await provider.connection.getAccountInfo(escrowPda);
    expect(escrowInfo).to.be.null;

    const vaultInfo = await provider.connection.getAccountInfo(vault);
    expect(vaultInfo).to.be.null;

    // Check balances
    const takerBalanceA = (
      await provider.connection.getTokenAccountBalance(takerAtaA)
    ).value.uiAmount;
    expect(takerBalanceA).to.equal(depositAmount);

    const makerBalanceB = (
      await provider.connection.getTokenAccountBalance(makerAtaB)
    ).value.uiAmount;
    expect(makerBalanceB).to.equal(receiveAmount);
  });
});
