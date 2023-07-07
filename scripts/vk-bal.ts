import hre, { ethers } from 'hardhat'
const { Contract } = ethers
import * as fs from 'fs'

import { balVKDatas } from '../verifier-configs/balance10'
import { MISTBalanceVerifier } from '../typechain-types'

async function main() {
    const [owner] = await ethers.getSigners()

    const deployments = JSON.parse(
        fs.readFileSync(
            `deployments/${hre.network.name}.json`,
            { encoding: 'utf-8' }
        )
    )
    const artifact = require('../artifacts/contracts/MISTBalanceVerifier.sol/MISTBalanceVerifier.json')
    const balanceVerifierContract = new Contract(
        deployments.MISTBalanceVerifier.address,
        artifact.abi,
        owner
    ) as MISTBalanceVerifier

    if (balVKDatas.length === 0) {
        console.log('No vkDatas found')
        return
    }

    console.log(`Setting ${balVKDatas.length} verifying keys for MIST Balance Verifier...`)
    if (balVKDatas.length > 1) {
        const tx = await balanceVerifierContract.setVerifyingKeys(
            balVKDatas.map((data) => data.ins),
            balVKDatas.map((data) => data.vk)
        )
        console.log(`Transaction hash: ${tx.hash} (waiting for confirmation...)`)
        await tx.wait()
        console.log('Transaction confirmed')
        console.log(
            `Verifying keys have been set for following # of ins:\n`,
            balVKDatas.map((data) => data.ins)
        )
    } else {
        const tx = await balanceVerifierContract.setVerifyingKey(
            balVKDatas[0].ins,
            balVKDatas[0].vk
        )
        console.log(`Transaction hash: ${tx.hash} (waiting for confirmation...)`)
        await tx.wait()
        console.log('Transaction confirmed')
        console.log(`Verifying key has been set for ${balVKDatas[0].ins} ins`)
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});