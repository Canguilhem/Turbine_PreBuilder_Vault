import sha3 from "crypto-js/sha3";
import { MerkleTree } from "merkletreejs";
import Papa from "papaparse";

// check that we use the same algo to verfiy the merkle proof on contract side
const sha256 = (data: string) => {
  return sha3(data, { outputLength: 256 });
};

type Account = {
  address: string;
  amount: number;
};

export class AllowList {
  private tree: MerkleTree;
  private receivers: Array<Account>;

  public static async fromCsv(data: string): Promise<AllowList> {
    const parseAsync = async (data: string) => {
      return new Promise((resolve, reject) => {
        Papa.parse(data, {
          header: true,
          delimiter: ";",
          transformHeader: (header) => header.trim().toLowerCase(),
          complete: (results) => resolve(results.data as Array<Account>),
          error: (error) => reject(error),
        });
      });
    };

    const records = await parseAsync(data);
    return new AllowList(records as Array<Account>);
  }

  constructor(accounts: Array<Account>) {
    // Sort by address!
    accounts.sort((a, b) =>
      a.address > b.address ? 1 : a.address < b.address ? -1 : 0,
    );
    // Check for duplicate addresses (error!)
    const dup = accounts.filter(
      (e, i, accounts) => i > 0 && e.address == accounts[i - 1].address,
    );
    if (dup.length > 0) {
      throw new Error(
        "Duplicate address found in source data: " + JSON.stringify(dup),
      );
    }
    const leaves = accounts.map((a) =>
      sha256(a.address.toLowerCase().trim() + a.amount),
    );
    this.tree = new MerkleTree(leaves, sha256, { sort: false });
    this.receivers = accounts;
  }

  public getMerkleRoot(): string {
    return this.tree.getHexRoot().replace("0x", "");
  }

  public getMerkleProof(account: Account): string[] {
    return this.tree
      .getPositionalHexProof(
        sha256(
          account.address.toLowerCase().trim() + account.amount,
        ).toString(),
      )
      .map((v) =>
        "0x".concat(
          v[0].toString().padStart(2, "0"),
          v[1].toString().replace("0x", ""),
        ),
      );
  }

  public dumpAllMerkleProofs() {
    const res: {
      [key: string]: Array<{ amount: number; proofs: Array<string> }>;
    } = {};

    this.receivers.forEach((account) => {
      const lowerTrimmedAddress = account.address.toLowerCase().trim();
      res[lowerTrimmedAddress] = [
        {
          amount: account.amount,
          proofs: this.getMerkleProof(account),
        },
      ];
    });
    return res;
  }
}
