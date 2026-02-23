import { readFileSync, writeFileSync } from "fs";
import { AllowList } from "./AllowList";

const generateMerkleTree = async () => {
  const data = readFileSync("utils/data/whitelist.csv", "utf8");

  //   shift the data by 1 row
  const shiftedData = data.split("\n").slice(1).join("\n");
  console.log(shiftedData);

  const accounts = [];
  for (const row of shiftedData.split("\n")) {
    const [address, amount] = row.split(";");
    accounts.push({ address, amount });
  }

  const allowList = new AllowList(accounts);
  const merkleRoot = allowList.getMerkleRoot();
  const proofs = allowList.dumpAllMerkleProofs();
  console.log("Merkle Root:", merkleRoot);
  console.log("Merkle Proofs:", proofs);

  //   writeFileSync("utils/data/merkle_root.txt", merkleRoot);
  writeFileSync(
    "utils/data/merkle_proofs.json",
    JSON.stringify({ ...proofs, merkleRoot }, null, 2),
    "utf8",
  );
};

generateMerkleTree();
