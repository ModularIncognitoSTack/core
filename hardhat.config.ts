import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import { config as dotenvConfig } from "dotenv";
dotenvConfig()

const config: HardhatUserConfig = {
  solidity: "0.8.18",
  gasReporter: {
    currency: "USD",
    enabled: true,
    excludeContracts: [],
    src: "./contracts",
  },
  defaultNetwork: "hardhat",
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  networks: {
    hardhat: {},
    goerli: {
      accounts: [process.env.PRIVATE_KEY || ""],
      url:`https://rpc.ankr.com/eth_goerli`,
      chainId: 5,
      allowUnlimitedContractSize: false,
    },
    sepolia: {
      accounts: [process.env.PRIVATE_KEY || ""],
      url:`https://rpc.ankr.com/eth_sepolia`,
      chainId: 11155111,
      allowUnlimitedContractSize: true,
    },
    lineaGoerli: {
      accounts: [process.env.PRIVATE_KEY || ""],
      url: `https://rpc.goerli.linea.build/`,
      chainId: 59140,
      allowUnlimitedContractSize: true,
    },
  },
};

export default config;
