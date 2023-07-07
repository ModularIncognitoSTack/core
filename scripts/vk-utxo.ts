import hre, { ethers } from 'hardhat'
const { Contract } = ethers
import * as fs from 'fs'

import { vkDatas } from '../verifier-configs/utxo10'
import { MISTUTXOVerifier } from '../typechain-types'

async function main() {
    const [owner] = await ethers.getSigners()

    const deployments = JSON.parse(
        fs.readFileSync(
            `deployments/${hre.network.name}.json`,
            { encoding: 'utf-8' }
        )
    )
    const artifact = require('../artifacts/contracts/MISTUTXOVerifier.sol/MISTUTXOVerifier.json')
    const utxoVerifierContract = new Contract(
        deployments.MISTUTXOVerifier.address,
        artifact.abi,
        owner
    ) as MISTUTXOVerifier

    if (vkDatas.length === 0) {
        console.log('No vkDatas found')
        return
    }

    console.log(`Setting verifying keys for ${vkDatas.length} UTXO verifier(s)...`)
    if (vkDatas.length > 1) {
        const tx = await utxoVerifierContract.setVerifyingKeys(vkDatas)
        console.log(`Transaction hash: ${tx.hash} (waiting for confirmation...)`)
        await tx.wait()
        console.log('Transaction confirmed')
        console.log(
            `Verifying keys have been set for the following UTXOs:\n`,
            vkDatas.map((vkData) => `${vkData.ins}x${vkData.outs} (quorum: ${vkData.quorum})`)
        )
    } else {
        const tx = await utxoVerifierContract.setVerifyingKey(
            vkDatas[0].ins,
            vkDatas[0].outs,
            vkDatas[0].quorum,
            vkDatas[0].vk
        )
        console.log(`Transaction hash: ${tx.hash} (waiting for confirmation...)`)
        await tx.wait()
        console.log('Transaction confirmed')
        console.log(`Verifying key has been set for UTXO ${vkDatas[0].ins}x${vkDatas[0].outs} (quorum: ${vkDatas[0].quorum})`)
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});