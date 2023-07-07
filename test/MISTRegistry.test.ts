import { expect } from "chai";
import { ethers } from "hardhat";
import {
    EdDSASigner,
    zeroValue,
    Account,
    signAccountData,
} from "@usemist/sdk"
import { proveMembership } from "@usemist/sdk/dist/utils/prover/node";
import { MISTRegistry, MISTAccountVerifier } from "../typechain-types";
import { poseidon2 } from "poseidon-lite";
import { BigNumber } from "ethers";
import path from "path";
import { defaultAbiCoder } from "ethers/lib/utils";
import { IncrementalMerkleTree } from "@zk-kit/incremental-merkle-tree";

const wasmFilePath = path.join(__dirname, "../zk/circuits/account/account10_js/account10.wasm");
const zKeyFilePath = path.join(__dirname, "../zk/zkeys/account10.zkey");
const PRIVATE_KEY = "0x1234567890123456789012345678901234567890123456789012345678901234"
const PRIVATE_KEY_2 = "0xABCDEABCDEABCDEABCDEABCDEABCDEABCDEABCDEABCDEABCDEABCDEABCDEAB"
const SPENDER_ROLE = BigInt(1);

const EMPTY_SIGNATURE = defaultAbiCoder.encode(["uint256"], [0])

describe("MIST Registry", function () {
    let registryTree: IncrementalMerkleTree
    let eddsaSigner: EdDSASigner
    let eddsaSigner2: EdDSASigner
    let account: Account
    let contract: MISTRegistry
    let verifier: MISTAccountVerifier
    let merkleDepth = 20;

    beforeEach("Create signer and account", async function () {
        const [signer] = await ethers.getSigners();
        eddsaSigner = new EdDSASigner(PRIVATE_KEY);
        await eddsaSigner.init();
        eddsaSigner2 = new EdDSASigner(PRIVATE_KEY_2);
        await eddsaSigner2.init();

        account = new Account(signer.address, 10);

        const PoseidonT3Factory = await ethers.getContractFactory("PoseidonT3");
        const poseidonT3 = await PoseidonT3Factory.deploy();

        const IncrementalBinaryTreeFactory = await ethers.getContractFactory("IncrementalBinaryTree", {
            libraries: {
                PoseidonT3: poseidonT3.address
            }
        });
        const tree = await IncrementalBinaryTreeFactory.deploy();

        const AccountVerifierFactory = await ethers.getContractFactory("MISTAccountVerifier");
        verifier = await AccountVerifierFactory.deploy();
        
        const MISTRegistryFactory = await ethers.getContractFactory("MISTRegistry", {
            libraries: {
                IncrementalBinaryTree: tree.address,
                PoseidonT3: poseidonT3.address
            }
        });
        contract = await MISTRegistryFactory.deploy(verifier.address)
        registryTree = new IncrementalMerkleTree(poseidon2, merkleDepth, zeroValue(0), 2)
    })

    describe("Registry Tree", function () {
        it("Should have initialized tree state", async function () {
            expect(await contract.root()).to.equal(BigNumber.from(registryTree.root));
        })
    })

    describe("Create Account", function () {
        it("Should create an account and emit Register event", async function () {
            const [signer] = await ethers.getSigners();
            const accountData = {
                account: signer.address,
                root: account.root,
                quorum: 1,
                registry: 0,
                merkleProof: defaultAbiCoder.encode(["uint256[]", "uint8[]"], [[],[]]),
                nonce: 1
            }
            
            const tx = contract.manageAccount(accountData, EMPTY_SIGNATURE);
            await expect(tx).to.emit(contract, "Register").withArgs(0, 0, account.accountId, poseidon2([account.root, BigInt(1)]));
            expect(await contract.getRoot(account.address)).to.equal(BigNumber.from(account.root));
        })

        it("Should create an account with relayer and emit Register event", async function () {
            const [signer, relayer] = await ethers.getSigners();
            const accountData = {
                account: signer.address,
                root: account.root,
                quorum: 1,
                registry: 0,
                merkleProof: defaultAbiCoder.encode(["uint256[]", "uint8[]"], [[],[]]),
                nonce: 1
            }
            const signature = signAccountData(signer, contract.address, accountData);
            const tx = contract.connect(relayer).manageAccount(accountData, signature);
            await expect(tx).to.emit(contract, "Register").withArgs(0, 0, account.accountId, poseidon2([account.root, BigInt(1)]));
        })
    })

    describe("Add Member", function () {
        beforeEach("Create an existing account", async function () {
            const [signer] = await ethers.getSigners();
            const accountData = {
                account: signer.address,
                root: account.root,
                quorum: 1,
                registry: 0,
                merkleProof: defaultAbiCoder.encode(["uint256[]", "uint8[]"], [[],[]]),
                nonce: 1
            }
            
            await contract.manageAccount(accountData, EMPTY_SIGNATURE);
            registryTree.insert(account.root);
        })

        it("Should update account with new member and emit Update event", async function () {
            const [signer] = await ethers.getSigners();
            
            const oldRoot = account.root
            const proof = registryTree.createProof(registryTree.indexOf(oldRoot))
            const registryProof = ethers.utils.defaultAbiCoder.encode(
                ["uint256[]", "uint8[]"],
                [proof.siblings.map((sibling) => sibling[0]), proof.pathIndices]
            )
            account.addSpender(eddsaSigner.scalarPubKey)
            const accountData = {
                account: signer.address,
                root: account.root,
                quorum: 1,
                registry: 0,
                merkleProof: registryProof,
                nonce: (await contract.getNonce(signer.address)).add(1).toBigInt()
            }
            
            const tx = contract.manageAccount(accountData, EMPTY_SIGNATURE);
            await expect(tx).to.emit(contract, "Update").withArgs(0, 0, account.accountId, poseidon2([oldRoot, BigInt(1)]), poseidon2([account.root, BigInt(1)]));
        })
    })

    describe("Update Member", function () {
        beforeEach("Create an existing account with a member", async function () {
            const [signer] = await ethers.getSigners()
            account.addSpender(eddsaSigner.scalarPubKey)
            const accountData = {
                account: signer.address,
                root: account.root,
                quorum: 1,
                registry: 0,
                merkleProof: defaultAbiCoder.encode(["uint256[]", "uint8[]"], [[],[]]),
                nonce: 1
            }
            
            await contract.manageAccount(accountData, EMPTY_SIGNATURE);
            registryTree.insert(account.root);
        })

        it("Should replace a member in an account and emit event", async function () {
            const [signer] = await ethers.getSigners();
            
            const oldRoot = account.root
            const proof = registryTree.createProof(registryTree.indexOf(oldRoot))
            const registryProof = ethers.utils.defaultAbiCoder.encode(
                ["uint256[]", "uint8[]"],
                [proof.siblings.map((sibling) => sibling[0]), proof.pathIndices]
            )
            account.addSpender(eddsaSigner2.scalarPubKey)
            account.removeSpender(eddsaSigner.scalarPubKey)
            const accountData = {
                account: signer.address,
                root: account.root,
                quorum: 1,
                registry: 0,
                merkleProof: registryProof,
                nonce: (await contract.getNonce(signer.address)).add(1).toBigInt()
            }
            
            const tx = contract.manageAccount(accountData, EMPTY_SIGNATURE);
            await expect(tx).to.emit(contract, "Update").withArgs(0, 0, account.accountId, poseidon2([oldRoot, BigInt(1)]), poseidon2([account.root, BigInt(1)]));
        })
    })

    describe("Verify Member", function () {
        beforeEach("Create an existing account with a member", async function () {
            const [signer] = await ethers.getSigners()
            account.addSpender(eddsaSigner.scalarPubKey)
            const accountData = {
                account: signer.address,
                root: account.root,
                quorum: 1,
                registry: 0,
                merkleProof: defaultAbiCoder.encode(["uint256[]", "uint8[]"], [[],[]]),
                nonce: 1
            }
            
            await contract.manageAccount(accountData, EMPTY_SIGNATURE);
            registryTree.insert(account.root);
        })

        it("Should verify member in account with ZK proof", async function () {
            const message = BigNumber.from(1).toBigInt();
            const signature = await eddsaSigner.signFormatted(message);
            const index = account.indexOf(eddsaSigner.scalarPubKey, SPENDER_ROLE);
            const accMerkleProof = account.generateMerkleProof(index)
            const proof = await proveMembership(
                wasmFilePath,
                zKeyFilePath,
                {
                    root: account.root,
                    message,
                    publicKey: eddsaSigner.scalarPubKey,
                    role: SPENDER_ROLE,
                    signature,
                    pathIndices: accMerkleProof.pathIndices,
                    pathSiblings: accMerkleProof.siblings
                }
            )
            expect(await verifier["verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[3])"](
                proof.a,
                proof.b,
                proof.c,
                [account.root, message, SPENDER_ROLE]
            )).to.be.true
            expect(await contract.verify(
                account.address,
                message,
                SPENDER_ROLE,
                defaultAbiCoder.encode(["uint256[2]", "uint256[2][2]", "uint256[2]"], [proof.a, proof.b, proof.c])
            )).to.be.true
        })
    })
})