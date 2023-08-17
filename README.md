# MIST Core
These are the core solidity smart contracts for MIST.

Their deployment addresses are below:

### Sepolia Testnet
| Contract | Address |
|----------|---------|
| MIST Registry | 0xF585aCAfEE1b11bee9945FE87e2ea78E4503CD65 |
| MIST Pool | 0x6bA81b91c72755459CfdF3c5ad25eFe636DCd493 |
| MIST UTXO Verifier | 0x7b14A5f2D0191Bf5e8633dB278c846563BFEA2f9 |
| MIST Balance Verifier | 0xB35203b311f062b77A0189c7f204752fc4954371 |
| MIST Account Verifier | 0x36d464CF2ca1dF9A83b9702492dFbe283682b8De |

### Linea Goerli Testnet
| Contract | Address |
|----------|---------|
| MIST Registry | 0xC0c79bd93b0990FC8D146C689332e01a5bCb00a6 |
| MIST Pool | 0xA9dd3C18cBFA9bc133F82Fd2272AF6737f02Fc3b |
| MIST UTXO Verifier | 0x56a76B1FB4DE43Cf9F1BdF938Ab27cB64de0F29B |
| MIST Balance Verifier | 0x4558B375148C65BD537DBaD74b143aBb78B15449 |
| MIST Account Verifier | 0x3E63e9c64942399e987A04f0663A5c1Cba9c148A |

## Setup Locally
For local development, clone this repo and install dependencies with:
```bash
yarn
```
Compile the smart contracts with ``npx hardhat compile`` or automatically through testing.

## Testing
To test, you can run one of the following commands in the terminal:
```bash
yarn test # Runs all tests
yarn test:pool # Runs only tests for MIST Pool
yarn test:reg # Runs only tests for MIST Registry
```
***Note: You will need the ZK artifacts to locally test these contracts which are not publicly available at this time.***
