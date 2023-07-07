import { BigNumber, Contract, ethers } from "ethers";
import {
    EncryptedNote,
    PreCommitment,
    TokenData,
    TokenStandard,
    UTXONote,
    MERKLE_DEPTH,
    createMerkleTree,
} from "@usemist/sdk";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { defaultAbiCoder } from "@ethersproject/abi";



export const ENCRYPTED_NOTE: EncryptedNote = {
    encryptedData: "0x0000000000000000000000000000000000000000000000000000000000000000",
    encryptedSenderKey: "0x0000000000000000000000000000000000000000000000000000000000000000",
    encryptedReceiverKey: "0x0000000000000000000000000000000000000000000000000000000000000000"
}

export async function createUTXOPoolMerkleTree(contract: Contract) {
    const filter = contract.filters.Commitment()
    const events = await contract.queryFilter(filter)
    return createMerkleTree(0, events.map(event => BigNumber.from(event.args?.commitment).toBigInt()), MERKLE_DEPTH)
}

// Mock Tokens
export async function mintAndApproveMockToken(
    signer: SignerWithAddress,
    operator: string,
    tokenContract: Contract,
    standard: TokenStandard | number,
    amount: BigNumber | number | bigint,
    identifier: BigNumber | number | bigint,
) {
    if (standard === TokenStandard.ERC20) {
        await tokenContract.connect(signer).mint(signer.address, amount);
        await tokenContract.connect(signer).approve(operator, amount);
    } else if (standard === TokenStandard.ERC721) {
        await tokenContract.connect(signer).mint(signer.address);
        await tokenContract.connect(signer).approve(operator, identifier);
    } else if (standard === TokenStandard.ERC1155) {
        await tokenContract.connect(signer).mint(signer.address, identifier, amount);
        await tokenContract.connect(signer).setApprovalForAll(operator, true);
    }
}


export async function generatePreCommitments(
    sender: string,
    receivers: string[],
    tokenDatas: TokenData[],
    nullifyingKey: bigint
): Promise<{ preCommitments: PreCommitment[], commitments: bigint[], notes: UTXONote[] }> {
    if (receivers.length !== tokenDatas.length) {
        throw new Error("receivers and tokenDatas must have the same length")
    }
    const preCommitments: PreCommitment[] = Array(receivers.length)
    const commitments: bigint[] = Array(receivers.length)
    const notes: UTXONote[] = Array(receivers.length)
    for (let i=0; i<receivers.length; i++) {
        const note = new UTXONote({
            index: 0,
            sender: sender,
            receiver: receivers[i],
            token: tokenDatas[i].token,
            identifier: BigNumber.from(tokenDatas[i].identifier).toBigInt(),
            amount: BigNumber.from(tokenDatas[i].amount).toBigInt(),
            nullifyingKey
        })
        const receiverHash = note.getAccountHash()
        // const encryptedNote = await note.encryptPacked('goerli')
        preCommitments[i] = {
            receiverHash,
            tokenData: tokenDatas[i],
            encryptedNote: defaultAbiCoder.encode(["tuple(string encryptedData, string encryptedSenderKey, string encryptedReceiverKey)"], [ENCRYPTED_NOTE]),
        }
        commitments[i] = note.getCommitment()
        notes[i] = note
    }
    return { preCommitments, commitments, notes }
}
