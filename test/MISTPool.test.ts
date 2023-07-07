import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
    TokenData,
    EdDSASigner,
    UTXONote,
    ExtData,
    TokenStandard,
    TransferType,
    MERKLE_DEPTH,
    ROLES,
    NULL_ADDRESS,
    zeroValue,
    Account,
    prepareDeposit,
    deposit,
    createRegistryMerkleProof,
    getExtDataHash,
    UTXOInputs,
    encodeFormattedProof,
    formatProof,
    prepareBalanceCheck,
    prepareBalanceProof,
} from "@usemist/sdk"
import { proveBalance, proveUTXO } from "@usemist/sdk/dist/utils/prover/node";
import { MISTRegistry, MISTBalanceVerifier, MockERC1155, MockERC20, MockERC721, MISTPool,  MISTUTXOVerifier } from "../typechain-types";
import { poseidon2, poseidon4 } from "poseidon-lite";
import { BigNumber, Contract } from "ethers";
import path from "path";
import {
    generatePreCommitments,
    ENCRYPTED_NOTE,
    mintAndApproveMockToken,
    createUTXOPoolMerkleTree
} from "../utils/helpers";
import { defaultAbiCoder, parseEther } from "ethers/lib/utils";
import { IncrementalMerkleTree } from "@zk-kit/incremental-merkle-tree";
import { vkDatas } from "../verifier-configs/utxo10";
import { balVKDatas } from "../verifier-configs/balance10";

const { SPENDER } = ROLES

const PRIVATE_KEY = "0x1234567890123456789012345678901234567890123456789012345678901234"
const PRIVATE_KEY_2 = "0xABCDEABCDEABCDEABCDEABCDEABCDEABCDEABCDEABCDEABCDEABCDEABCDEAB"

const wasmFilePath = path.join(__dirname, "../zk/circuits/mfa_utxo/mfa_transaction10_1x1_2_js/mfa_transaction10_1x1_2.wasm")
const zKeyFilePath = path.join(__dirname, "../zk/zkeys/mfa_transaction10_1x1_2.zkey")
const balWasmFilePath = path.join(__dirname, "../zk/circuits/balance/balance10_1_js/balance10_1.wasm")
const balZKeyFilePath = path.join(__dirname, "../zk/zkeys/balance10_1.zkey")


describe("MIST Pool", function () {
    let registry: IncrementalMerkleTree
    let signer1: SignerWithAddress
    let signer2: SignerWithAddress
    let eddsaSigner1: EdDSASigner
    let eddsaSigner2: EdDSASigner
    let account1: Account
    let account2: Account
    let nullifyingKey: bigint
    
    let accountContract: MISTRegistry
    let utxoContract: MISTPool
    let utxoVerifier: MISTUTXOVerifier
    let balanceVerifier: MISTBalanceVerifier
    let mockERC20Contract: MockERC20
    let mockERC721Contract: MockERC721
    let mockERC1155Contract: MockERC1155

    beforeEach("Create signer and account", async function () {
        // Init signers
        [signer1, signer2] = await ethers.getSigners();
        eddsaSigner1 = new EdDSASigner(PRIVATE_KEY);
        await eddsaSigner1.init();
        eddsaSigner2 = new EdDSASigner(PRIVATE_KEY_2);
        await eddsaSigner2.init();

        
        // Deploy contracts
        const PoseidonT3Factory = await ethers.getContractFactory("PoseidonT3");
        const poseidonT3 = await PoseidonT3Factory.deploy();
        
        const IncrementalBinaryTreeFactory = await ethers.getContractFactory("IncrementalBinaryTree", {
            libraries: {
                PoseidonT3: poseidonT3.address
            }
        });
        const tree = await IncrementalBinaryTreeFactory.deploy();
        
        const AccountRegistryFactory = await ethers.getContractFactory("MISTRegistry", {
            libraries: {
                IncrementalBinaryTree: tree.address,
                PoseidonT3: poseidonT3.address
            }
        });
        accountContract = await AccountRegistryFactory.deploy("0x0000000000000000000000000000000000000000")
        
        const UTXOVerifierFactory = await ethers.getContractFactory("MISTUTXOVerifier");
        utxoVerifier = await UTXOVerifierFactory.deploy();

        await utxoVerifier.setVerifyingKeys(vkDatas)
        
        const BalanceVerifierFactory = await ethers.getContractFactory("MISTBalanceVerifier");
        balanceVerifier = await BalanceVerifierFactory.deploy();

        await balanceVerifier.setVerifyingKeys(balVKDatas.map(data => data.ins), balVKDatas.map(data => data.vk))
        
        const PoseidonT5Factory = await ethers.getContractFactory("PoseidonT5");
        const poseidonT5 = await PoseidonT5Factory.deploy();
        
        const UTXOPoolFactory = await ethers.getContractFactory("MISTPool", {
            libraries: {
                IncrementalBinaryTree: tree.address,
                PoseidonT5: poseidonT5.address
            }
        });
        utxoContract = await UTXOPoolFactory.deploy(accountContract.address, utxoVerifier.address, balanceVerifier.address);
        nullifyingKey = (await utxoContract.getNullifyingKey()).toBigInt();
        
        // Deploy mock tokens
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        mockERC20Contract = await MockERC20Factory.deploy();
        const MockERC721Factory = await ethers.getContractFactory("MockERC721");
        mockERC721Contract = await MockERC721Factory.deploy();
        const MockERC1155Factory = await ethers.getContractFactory("MockERC1155");
        mockERC1155Contract = await MockERC1155Factory.deploy();
        
        // Init registry
        registry = new IncrementalMerkleTree(poseidon2, MERKLE_DEPTH, zeroValue(0), 2)
        expect(await accountContract.root()).to.equal(registry.root)
        
        // Init accounts
        account1 = new Account(signer1.address, 10, 2);
        account1.addSpender(eddsaSigner1.scalarPubKey);
        account1.addSpender(eddsaSigner2.scalarPubKey);
        account2 = new Account(signer2.address, 10, 1);
        account2.addSpender(eddsaSigner1.scalarPubKey);
        account2.addSpender(eddsaSigner2.scalarPubKey);
        const leaf1 = poseidon2([account1.root, BigInt(account1.quorum)])
        const leaf2 = poseidon2([account2.root, BigInt(account2.quorum)])
        registry.insert(leaf1)
        registry.insert(leaf2)
        const rmp1 = registry.createProof(registry.indexOf(leaf1))
        await accountContract.connect(signer1).manageAccount(
            {
                account: signer1.address,
                root: account1.root,
                quorum: 2,
                registry: 0,
                merkleProof: defaultAbiCoder.encode(["uint256[]", "uint8[]"], [rmp1.siblings.map(s => BigInt(s)), rmp1.pathIndices]),
                nonce: 1
            },
            defaultAbiCoder.encode(["uint256"], [0]),
        )
        
        const rmp2 = registry.createProof(registry.indexOf(leaf2))
        await accountContract.connect(signer2).manageAccount(
            {
                account: signer2.address,
                root: account2.root,
                quorum: 1,
                registry: 0,
                merkleProof: defaultAbiCoder.encode(["uint256[]", "uint8[]"], [rmp2.siblings.map(s => BigInt(s)), rmp2.pathIndices]),
                nonce: 1
            },
            defaultAbiCoder.encode(["uint256"], [0]),
        )
        expect(await accountContract.root()).to.equal(registry.root)
    })

    describe("Deposit", function () {
        it("Should validate deposit", async function () {
            const tokenData: TokenData = {
                standard: TokenStandard.ERC20,
                token: mockERC20Contract.address,
                identifier: BigNumber.from(0),
                amount: parseEther('100'),
            }
            const { preCommitments } = await generatePreCommitments(signer2.address, [signer2.address], [tokenData], nullifyingKey)
            const { depositData, signature } = await prepareDeposit(signer2, utxoContract, preCommitments)
            const [valid] = await utxoContract.isValidDeposit(depositData, signature)
            expect(valid).to.be.true
        })
        
        it("Should deposit through relayer/bundler and emit events", async function () {
            await mintAndApproveMockToken(signer1, utxoContract.address, mockERC20Contract, TokenStandard.ERC20, parseEther('100'), 0)

            const tokenData: TokenData = {
                standard: TokenStandard.ERC20,
                token: mockERC20Contract.address,
                identifier: BigNumber.from(0),
                amount: parseEther('100'),
            }

            const { preCommitments, commitments } = await generatePreCommitments(signer1.address, [signer1.address], [tokenData], nullifyingKey)
            const { depositData, signature } = await prepareDeposit(signer1, utxoContract.connect(signer2), preCommitments)
            const tx = await utxoContract.connect(signer2).deposit(depositData, signature)
            
            await expect(tx).to.not.be.reverted
            const encryptedNote = defaultAbiCoder.encode(["tuple(string encryptedData, string encryptedSenderKey, string encryptedReceiverKey)"], [ENCRYPTED_NOTE])
            await expect(tx).to.emit(utxoContract, "Commitment").withArgs(
                0,
                0,
                commitments[0],
                encryptedNote
            );
            await expect(tx).to.emit(utxoContract, "Deposit").withArgs(
                0,
                depositData.sender,
                depositData.preCommitments[0].tokenData.token,
                depositData.preCommitments[0].tokenData.identifier,
                depositData.preCommitments[0].tokenData.amount,
                commitments[0]
            );
            await expect(tx).to.emit(mockERC20Contract, "Transfer").withArgs(signer1.address, utxoContract.address, parseEther('100'))
        })
    })

    describe("Balance", function () {
        it("Should verifyBalance and return true", async function () {
            await mintAndApproveMockToken(signer1, utxoContract.address, mockERC20Contract, TokenStandard.ERC20, parseEther('100'), 0)
    
            const tokenData: TokenData = {
                standard: TokenStandard.ERC20,
                token: mockERC20Contract.address,
                identifier: BigNumber.from(0),
                amount: parseEther('100'),
            }

            const { preCommitments, notes } = await generatePreCommitments(signer1.address, [signer1.address], [tokenData], nullifyingKey)
            await deposit(signer1, utxoContract, preCommitments)

            const proofInputs = await prepareBalanceProof({
                account: account1,
                signer: eddsaSigner1,
                role: SPENDER,
                registry: registry,
                utxoTree: await createUTXOPoolMerkleTree(utxoContract),
                tokenAddress: mockERC20Contract.address,
                minBalance: 1n,
                notes,
                nullifyingKey
            })
            const proof = await proveBalance(balWasmFilePath, balZKeyFilePath, proofInputs)
            const receipt = utxoContract.verifyBalanceOf(
                mockERC20Contract.address,
                1n,
                proofInputs.root,
                proofInputs.registryRoot,
                proofInputs.nullifiers,
                defaultAbiCoder.encode(["uint256[2]", "uint256[2][2]", "uint256[2]"], [proof.a, proof.b, proof.c])
            )
            await expect(receipt).to.not.be.reverted
        })
    })

    describe("Transfer", function () {
        it("Should transfer 1x1 with 2-factor authentication", async function () {
            await mintAndApproveMockToken(signer1, utxoContract.address, mockERC20Contract, TokenStandard.ERC20, parseEther('100'), 0)
    
            const tokenData: TokenData = {
                standard: TokenStandard.ERC20,
                token: mockERC20Contract.address,
                identifier: BigNumber.from(0),
                amount: parseEther('100'),
            }

            const { preCommitments, notes } = await generatePreCommitments(signer1.address, [signer1.address], [tokenData], nullifyingKey)
            await deposit(signer1, utxoContract, preCommitments)
            
            const extData: ExtData = {
                chainId: await signer1.getChainId(),
                treeIndex: 0,
                account: NULL_ADDRESS,
                transferType: TransferType.Transfer,
                tokenData,
            }
            
            const extDataHash = getExtDataHash(extData);
            
            const inNote = notes[0];

            const outNote = new UTXONote({
                index: 1,
                sender: signer1.address,
                receiver: signer2.address,
                token: mockERC20Contract.address,
                identifier: BigInt(0),
                amount: parseEther('100').toBigInt(),
                nullifyingKey,
            })
            
            let inputs: UTXONote[] = [inNote];
            let outputs: UTXONote[] = [outNote];
            const tree = await createUTXOPoolMerkleTree(utxoContract);
            const root = BigNumber.from(tree.root).toBigInt();
            let inPathIndices: number[] = [];
            let inPathElements: bigint[][] = [];
    
            const message = poseidon4([
                root,
                extDataHash.toBigInt(),
                inNote.getNullifier(),
                outNote.getCommitment(),
            ])
    
            const signatures = [
                await eddsaSigner1.signFormatted(message),
                await eddsaSigner2.signFormatted(message),
            ]
            
            for (const input of inputs) {
                if (input.amount > 0) {
                    input.setIndex(tree.indexOf(input.getCommitment()))
                    if (input.index < 0) {
                        throw new Error(`Input commitment ${input.getCommitment()} was not found`)
                    }
                    inPathIndices.push(input.index)
                    // const element = tree.path(input.index).pathElements
                    const element = tree.createProof(input.index).siblings
                    inPathElements.push(element.map((e: bigint) => e))
                } else {
                    inPathIndices.push(0)
                    inPathElements.push(new Array(tree.depth).fill(BigInt(0)))
                }
            }
    
            const memberIndex = account1.indexOf(eddsaSigner1.scalarPubKey, SPENDER)
            const memberIndex2 = account1.indexOf(eddsaSigner2.scalarPubKey, SPENDER)
            const memberMerkleProof1 = account1.generateMerkleProof(memberIndex)
            const memberMerkleProof2 = account1.generateMerkleProof(memberIndex2)
    
            const registryRoot = BigNumber.from(registry.root).toBigInt()
            const { registryPathSiblings, registryPathIndices } = createRegistryMerkleProof(registry, poseidon2([account1.root, BigInt(2)]))
            
            let circuitInput: UTXOInputs = {
                root,
                registryRoot,
                extDataHash: extDataHash.toBigInt(),
                inNullifiers: inputs.map(input => input.getNullifier()),
                outCommitments: outputs.map(output => output.getCommitment()),
                publicKeys: [eddsaSigner1.scalarPubKey, eddsaSigner2.scalarPubKey],
                signatures,
                roles: [SPENDER, SPENDER],
                aclRoot: memberMerkleProof1.root,
                aclPathSiblings: [memberMerkleProof1.siblings, memberMerkleProof2.siblings],
                aclPathIndices: [memberMerkleProof1.pathIndices, memberMerkleProof2.pathIndices],
                accountId: account1.accountId,
                nullifyingKey,
                registryPathSiblings,
                registryPathIndices,
                token: BigNumber.from(tokenData.token).toBigInt(),
                tokenId: inNote.identifier,
                inAmounts: inputs.map(input => input.amount),
                inRandoms: inputs.map(input => input.random),
                inPathElements,
                inPathIndices,
                outAmounts: outputs.map(output => output.amount),
                outAccountHashes: outputs.map(output => output.getAccountHash()),
            }
    
            const proof = await proveUTXO(wasmFilePath, zKeyFilePath, circuitInput);
            expect(proof).to.not.be.undefined;
        
            const encodedNotes = outputs.map(() => defaultAbiCoder.encode(["tuple(string encryptedData, string encryptedSenderKey, string encryptedReceiverKey)"], [ENCRYPTED_NOTE]))
            const tx = utxoContract.transfer(
                // defaultAbiCoder.encode(["tuple(uint256[2] a,uint256[2][2] b,uint256[2] c)"], [proof]),
                encodeFormattedProof(formatProof(proof)),
                defaultAbiCoder.encode(
                    ["uint256", "uint256", "uint256", "uint256", "uint256[]", "uint256[]", "bytes[]"],
                    [circuitInput.root, circuitInput.registryRoot, 0, 2, circuitInput.inNullifiers, circuitInput.outCommitments, encodedNotes]
                ),
                extData
            )

            await expect(tx).to.not.be.reverted
        })
    })

    describe("Withdraw", function () {
        it("Should withdraw 1x1 with 2-factor authentication", async function () {
            await mintAndApproveMockToken(signer1, utxoContract.address, mockERC20Contract, TokenStandard.ERC20, parseEther('100'), 0)

            const tokenData: TokenData = {
                standard: TokenStandard.ERC20,
                token: mockERC20Contract.address,
                identifier: BigNumber.from(0),
                amount: parseEther('100'),
            }

            const { preCommitments, notes } = await generatePreCommitments(signer1.address, [signer1.address], [tokenData], nullifyingKey)
            await deposit(signer1, utxoContract, preCommitments)
            
            const extData: ExtData = {
                chainId: await signer1.getChainId(),
                treeIndex: 0,
                account: signer2.address,
                transferType: TransferType.Withdrawal,
                tokenData,
            }
            
            const extDataHash = getExtDataHash(extData);
            
            const inNote = notes[0];

            const withdrawalNote = new UTXONote({
                index: 1,
                sender: signer1.address,
                receiver: signer2.address,
                token: mockERC20Contract.address,
                identifier: BigInt(0),
                amount: parseEther('100').toBigInt(),
                nullifyingKey,
                transferType: TransferType.Withdrawal,
            })
            
            let inputs: UTXONote[] = [inNote];
            let outputs: UTXONote[] = [withdrawalNote];
            const tree = await createUTXOPoolMerkleTree(utxoContract);
            const root = BigNumber.from(tree.root).toBigInt();
            let inPathIndices: number[] = [];
            let inPathElements: bigint[][] = [];
    
            const message = poseidon4([
                root,
                extDataHash.toBigInt(),
                inNote.getNullifier(),
                withdrawalNote.getCommitment(),
            ])
    
            const signatures = [
                await eddsaSigner1.signFormatted(message),
                await eddsaSigner2.signFormatted(message),
            ]
            
            for (const input of inputs) {
                if (input.amount > 0) {
                    input.setIndex(tree.indexOf(input.getCommitment()))
                    if (input.index < 0) {
                        throw new Error(`Input commitment ${input.getCommitment()} was not found`)
                    }
                    inPathIndices.push(input.index)
                    // const element = tree.path(input.index).pathElements
                    const element = tree.createProof(input.index).siblings
                    inPathElements.push(element.map((e: bigint) => e))
                } else {
                    inPathIndices.push(0)
                    inPathElements.push(new Array(tree.depth).fill(BigInt(0)))
                }
            }
    
            const memberIndex = account1.indexOf(eddsaSigner1.scalarPubKey, SPENDER)
            const memberIndex2 = account1.indexOf(eddsaSigner2.scalarPubKey, SPENDER)
            const memberMerkleProof1 = account1.generateMerkleProof(memberIndex)
            const memberMerkleProof2 = account1.generateMerkleProof(memberIndex2)
    
            const registryRoot = BigNumber.from(registry.root).toBigInt()
            const { registryPathSiblings, registryPathIndices } = createRegistryMerkleProof(registry, poseidon2([account1.root, BigInt(2)]))
            
            let circuitInput: UTXOInputs = {
                root,
                registryRoot,
                extDataHash: extDataHash.toBigInt(),
                inNullifiers: inputs.map(input => input.getNullifier()),
                outCommitments: outputs.map(output => output.getCommitment()),
                publicKeys: [eddsaSigner1.scalarPubKey, eddsaSigner2.scalarPubKey],
                signatures,
                roles: [SPENDER, SPENDER],
                aclRoot: memberMerkleProof1.root,
                aclPathSiblings: [memberMerkleProof1.siblings, memberMerkleProof2.siblings],
                aclPathIndices: [memberMerkleProof1.pathIndices, memberMerkleProof2.pathIndices],
                accountId: account1.accountId,
                nullifyingKey,
                registryPathSiblings,
                registryPathIndices,
                token: BigNumber.from(tokenData.token).toBigInt(),
                tokenId: inNote.identifier,
                inAmounts: inputs.map(input => input.amount),
                inRandoms: inputs.map(input => input.random),
                inPathElements,
                inPathIndices,
                outAmounts: outputs.map(output => output.amount),
                outAccountHashes: outputs.map(output => output.getAccountHash()),
            }
    
            const proof = await proveUTXO(wasmFilePath, zKeyFilePath, circuitInput);
            expect(proof).to.not.be.undefined;
        
            const encodedNotes = outputs.map(() => defaultAbiCoder.encode(["tuple(string encryptedData, string encryptedSenderKey, string encryptedReceiverKey)"], [ENCRYPTED_NOTE]))
            const tx = utxoContract.withdraw(
                // defaultAbiCoder.encode(["tuple(uint256[2] a,uint256[2][2] b,uint256[2] c)"], [proof]),
                encodeFormattedProof(formatProof(proof)),
                defaultAbiCoder.encode(
                    ["uint256", "uint256", "uint256", "uint256", "uint256[]", "uint256[]", "bytes[]"],
                    [circuitInput.root, circuitInput.registryRoot, 0, 2, circuitInput.inNullifiers, [], []]
                ),
                extData
            )

            await expect(tx).to.not.be.reverted
        })
    })
})