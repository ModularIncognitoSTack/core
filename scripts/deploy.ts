import hre, { ethers } from 'hardhat'
import * as fs from 'fs'
import { Contract } from 'ethers';

type Contracts = 'MISTRegistry' | 'MISTPool' | 'MISTUTXOVerifier' | 'MISTBalanceVerifier' | 'MISTAccountVerifier' | 'PoseidonT3' | 'PoseidonT5' | 'IncrementalBinaryTree';
type Context = {
    address: string;
    constructorArgs: any[];
    libraries: Object;
}

function toFile(path: string, deployment: Record<Contracts, Context>) {
    fs.writeFileSync(path, JSON.stringify(deployment), { encoding: 'utf-8' });
};

async function verifyContract(name: string, instance: Contract, constructorArgs: any[]) {
    if (hre.network.name !== ('localhost' || 'hardhat')) {
        try {
            const code = await ethers.provider.getCode(
                instance.address
            );
            if (code === '0x') {
                console.log(`${name} contract deployment has not completed. Waiting to verify...`);
                await instance.deployed()
            }
            await hre.run('verify:verify', {
                address: instance.address,
                contract: `contracts/${name}.sol:${name}`,
                constructorArguments: constructorArgs,
            });
        } catch ({ message }: any) {
            if ((message as string).includes('Reason: Already Verified')) {
                console.log('Reason: Already Verified');
            }
            console.error(message);
        }
    }
}

async function main() {
    console.log(`Deploying to ${hre.network.name}...`)

    console.log("\nLibraries:")
    const PoseidonT3Factory = await ethers.getContractFactory("PoseidonT3");
    const poseidonT3 = await PoseidonT3Factory.deploy();
    await poseidonT3.deployed();
    console.log(`PoseidonT3 deployed to ${poseidonT3.address}`)

    const PoseidonT5Factory = await ethers.getContractFactory("PoseidonT5");
    const poseidonT5 = await PoseidonT5Factory.deploy();
    await poseidonT5.deployed();
    console.log(`PoseidonT5 deployed to ${poseidonT5.address}`)

    const IncrementalBinaryTreeFactory = await ethers.getContractFactory("IncrementalBinaryTree", {
        libraries: {
            PoseidonT3: poseidonT3.address
        }
    });
    const tree = await IncrementalBinaryTreeFactory.deploy();
    await tree.deployed();
    console.log(`IncrementalBinaryTree deployed to ${tree.address}`)

    console.log("\nRegistry:")
    const AccountVerifierFactory = await ethers.getContractFactory("MISTAccountVerifier");
    const accountVerifier = await AccountVerifierFactory.deploy();
    await accountVerifier.deployed();
    console.log(`MISTAccountVerifier deployed to ${accountVerifier.address}`)
    
    const RegistryFactory = await ethers.getContractFactory("MISTRegistry", {
        libraries: {
            IncrementalBinaryTree: tree.address,
            PoseidonT3: poseidonT3.address
        }
    });
    const registry = await RegistryFactory.deploy(accountVerifier.address)
    await registry.deployed();
    console.log(`MISTRegistry deployed to ${registry.address}`)

    console.log("\nPool:")
    const UTXOVerifierFactory = await ethers.getContractFactory("MISTUTXOVerifier");
    const utxoVerifier = await UTXOVerifierFactory.deploy();
    await utxoVerifier.deployed();
    console.log(`MISTUTXOVerifier deployed to ${utxoVerifier.address} (owner: ${await utxoVerifier.owner()})`)

    const BalanceVerifierFactory = await ethers.getContractFactory("MISTBalanceVerifier");
    const balanceVerifier = await BalanceVerifierFactory.deploy();
    await balanceVerifier.deployed();
    console.log(`MISTBalanceVerifier deployed to ${balanceVerifier.address} (owner: ${await balanceVerifier.owner()})`)

    const MISTPoolFactory = await ethers.getContractFactory("MISTPool", {
        libraries: {
            IncrementalBinaryTree: tree.address,
            PoseidonT5: poseidonT5.address
        }
    });
    const pool = await MISTPoolFactory.deploy(registry.address, utxoVerifier.address, balanceVerifier.address);
    await pool.deployed();
    console.log(`MISTPool deployed to ${pool.address}`)

    const deployments: Record<Contracts, Context> = {
        MISTRegistry: {
            address: registry.address,
            constructorArgs: [
                accountVerifier.address
            ],
            libraries: {
                IncrementalBinaryTree: tree.address,
                PoseidonT3: poseidonT3.address
            }
        },
        MISTPool: {
            address: pool.address,
            constructorArgs: [
                registry.address,
                utxoVerifier.address,
                balanceVerifier.address
            ],
            libraries: {
                IncrementalBinaryTree: tree.address,
                PoseidonT5: poseidonT5.address
            }
        },
        MISTUTXOVerifier: {
            address: utxoVerifier.address,
            constructorArgs: [],
            libraries: {}
        },
        MISTAccountVerifier: {
            address: accountVerifier.address,
            constructorArgs: [],
            libraries: {}
        },
        MISTBalanceVerifier: {
            address: balanceVerifier.address,
            constructorArgs: [],
            libraries: {}
        },
        IncrementalBinaryTree: {
            address: tree.address,
            constructorArgs: [],
            libraries: {
                PoseidonT3: poseidonT3.address
            }
        },
        PoseidonT3: {
            address: poseidonT3.address,
            constructorArgs: [],
            libraries: {}
        },
        PoseidonT5: {
            address: poseidonT5.address,
            constructorArgs: [],
            libraries: {}
        },
    };

    toFile(`deployments/${hre.network.name}.json`, deployments);
    console.log(`\nDeployments written to deployments/${hre.network.name}.json`);

    const contracts = [
        { name: 'MISTRegistry', instance: registry, constructorArgs: deployments.MISTRegistry.constructorArgs },
        { name: 'MISTPool', instance: pool, constructorArgs: deployments.MISTPool.constructorArgs },
        { name: 'MISTUTXOVerifier', instance: utxoVerifier, constructorArgs: deployments.MISTUTXOVerifier.constructorArgs },
        { name: 'MISTAccountVerifier', instance: accountVerifier, constructorArgs: deployments.MISTAccountVerifier.constructorArgs },
        { name: 'MISTBalanceVerifier', instance: balanceVerifier, constructorArgs: deployments.MISTBalanceVerifier.constructorArgs },
    ]
    for (let i = 0; i < contracts.length; i++) {
        let {name, instance, constructorArgs} = contracts[i]
        await verifyContract(name, instance, constructorArgs)
    }
    
    console.log(`\n🎉🎉🎉 MIST is now on ${hre.network.name}! 🎉🎉🎉\n`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});