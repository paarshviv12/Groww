import { HardhatUserConfig, subtask } from "hardhat/config";
import { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } from "hardhat/builtin-tasks/task-names";
import "@nomicfoundation/hardhat-toolbox-viem";
import * as fs from "fs";

// Optional: use a locally installed solc binary (only needed in locked-down environments).
// On a normal machine leave SOLC_BIN unset and Hardhat downloads the compiler itself.
const SOLC_BIN = process.env.SOLC_BIN;
if (SOLC_BIN && fs.existsSync(SOLC_BIN)) {
  subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args: any, _hre, runSuper) => {
    if (args.solcVersion === "0.8.28") {
      return {
        compilerPath: SOLC_BIN,
        isSolcJs: false,
        version: "0.8.28",
        longVersion: "0.8.28+commit.7893614a",
      };
    }
    return runSuper();
  });
}

const DEPLOYER_KEY = process.env.DEPLOYER_KEY; // throwaway hackathon wallet only
const accounts = DEPLOYER_KEY ? [DEPLOYER_KEY.startsWith("0x") ? DEPLOYER_KEY : `0x${DEPLOYER_KEY}`] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris" },
  },
  networks: {
    hashkey: { url: process.env.HSK_MAINNET_RPC || "https://mainnet.hsk.xyz", chainId: 177, accounts },
    hashkeyTestnet: { url: process.env.HSK_TESTNET_RPC || "https://testnet.hsk.xyz", chainId: 133, accounts },
  },
};

export default config;
