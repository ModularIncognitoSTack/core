// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;
pragma abicoder v2;

import { IncrementalTreeData, IncrementalBinaryTree } from "./libraries/IncrementalBinaryTree.sol";
import { IMISTRegistry } from "@usemist/modules/interfaces/IMISTRegistry.sol";
import { IAccountVerifier } from "@usemist/modules/interfaces/IAccountVerifier.sol";
import { AccountData } from "@usemist/modules/libraries/RegistryStructs.sol";
import { PoseidonT3 } from "poseidon-solidity/PoseidonT3.sol";
import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

error InvalidSignature();
error InvalidMerkleProof();
error InvalidQuorum();
error InvalidNonce();
error InvalidRoot();
error InvalidRegistryTreeNumber();

/**
 * @title MIST Registry
 * @author geovgy
 * @notice MIST Registry is a Merkle tree based registry that enables private smart accounts
 * by storing the Merkle root and quorum of each account. An account's Merkle tree holds all 
 * the signers and their roles in the account. The quorum of each account is the number of 
 * signatures required for a valid transaction in the MIST Pool and could extend to other protocols.
 * Note, The quorum is not required for verifying proof of membership in an account.
 */
contract MISTRegistry is IMISTRegistry, EIP712 {
    using IncrementalBinaryTree for IncrementalTreeData;
    
    // The account verifier contract
    address public verifier;
    
    mapping(uint256 => IncrementalTreeData) public trees;
    uint256 internal _currentTreeNumber;
    // Tree number => Merkle root => block number when replaced
    mapping(uint256 => mapping(uint256 => uint256)) internal _pastRoots;
    uint256 internal constant MERKLE_DEPTH = 20;
    uint256 internal BLOCK_WINDOW = 100;

    // Mapping of account ID to its merkle root
    mapping(uint256 => uint256) internal _accountRoots;
    mapping(uint256 => uint256) internal _nonce;
    mapping(uint256 => uint256) internal _quorum;
    // Reference of account's leaf within the registry tree
    mapping(uint256 => uint256) internal _leaf;

    string private constant SIGNING_DOMAIN = "MISTRegistry";
    string private constant SIGNATURE_VERSION = "1";
    bytes32 private constant ACCOUNT_TYPE_HASH = keccak256("AccountData(address account,uint256 root,uint256 quorum,uint256 registry,bytes merkleProof,uint256 nonce)");

    event Register(uint256 indexed tree, uint256 indexed index, uint256 indexed accountId, uint256 leaf);
    event Update(uint256 indexed tree, uint256 indexed index, uint256 indexed accountId, uint256 oldLeaf, uint256 newLeaf);

    constructor(address _verifier) EIP712(SIGNING_DOMAIN, SIGNATURE_VERSION) {
        _init(_currentTreeNumber);
        verifier = _verifier;
    }

    function manageAccount(AccountData calldata data, bytes calldata signature) external {
        uint256 accountId = uint256(keccak256(abi.encode(data.account)));
        if (data.root == 0) revert InvalidRoot();
        if (data.nonce != _nonce[accountId] + 1) revert InvalidNonce();
        if (data.quorum == 0) revert InvalidQuorum();
        if (
            msg.sender != data.account &&
            !_isValidSignature(data.account, _hashAccountData(data), signature)
        ) revert InvalidSignature();
        uint256 oldLeaf = _leaf[accountId];
        uint256 newLeaf = PoseidonT3.hash([data.root, data.quorum]);
        if (oldLeaf == 0) {
            if (data.registry != _currentTreeNumber) revert InvalidRegistryTreeNumber();
            _insert(accountId, newLeaf);
            _accountRoots[accountId] = data.root;
            _quorum[accountId] = data.quorum;
        } else {
            _update(data.registry, accountId, oldLeaf, newLeaf, data.merkleProof);
            _accountRoots[accountId] = data.root;
            _quorum[accountId] = data.quorum;
        }
        unchecked {
            ++_nonce[accountId];
        }
    }

    function setQuorum(uint256 quorum) external {
        if (quorum == 0) revert InvalidQuorum();
        uint256 accountId = uint256(keccak256(abi.encode(msg.sender)));
        _quorum[accountId] = quorum;
    }

    function root() public view returns (uint256) {
        return trees[_currentTreeNumber].root;
    }

    function rootOf(uint256 treeNumber) public view returns (uint256) {
        return trees[treeNumber].root;
    }

    function currentRegistryTreeNumber() external view returns (uint256) {
        return _currentTreeNumber;
    }

    function getRoot(address account) external view returns (uint256) {
        uint256 accountId = uint256(keccak256(abi.encode(account)));
        return _accountRoots[accountId];
    }

    function getNonce(address account) external view returns (uint256) {
        uint256 accountId = uint256(keccak256(abi.encode(account)));
        return _nonce[accountId];
    }

    function getQuorum(address account) external view returns (uint256) {
        uint256 accountId = uint256(keccak256(abi.encode(account)));
        return _quorum[accountId];
    }

    function exists(address account) external view returns (bool) {
        uint256 accountId = uint256(keccak256(abi.encode(account)));
        return _leaf[accountId] != 0;
    }

    function isValidRoot(uint256 merkleRoot) external view returns (bool) {
        if (root() == merkleRoot) return true;
        else {
            uint256 blockNumber = _pastRoots[_currentTreeNumber][merkleRoot];
            return blockNumber > 0 && block.number - blockNumber < BLOCK_WINDOW;
        }
    }

    function isValidRoot(uint256 treeNumber, uint256 merkleRoot) external view returns (bool) {
        if (rootOf(treeNumber) == merkleRoot) return true;
        else {
            uint256 blockNumber = _pastRoots[treeNumber][merkleRoot];
            return blockNumber > 0 && block.number - blockNumber < BLOCK_WINDOW;
        }
    }

    function verify(
        address account,
        uint256 message,
        uint256 role,
        bytes calldata proof
    ) external view returns (bool) {
        uint256 accountId = uint256(keccak256(abi.encode(account)));
        uint256 _root = _accountRoots[accountId];
        return IAccountVerifier(verifier).verifyProof(proof, _root, message, role);
    }

    function _init(uint256 index) private {
        uint256 zeroValue = uint256(keccak256(abi.encodePacked(uint256(index)))) >> 8;
        trees[index].init(MERKLE_DEPTH, zeroValue);
    }

    function _createTree() internal {
        unchecked {
            ++_currentTreeNumber;
        }
        _init(_currentTreeNumber);
    }

    function _isRegistryTreeFull() internal view returns (bool) {
        return trees[_currentTreeNumber].numberOfLeaves == 2**MERKLE_DEPTH;
    }

    function _insert(uint256 accountId, uint256 newLeaf) internal {
        if (_isRegistryTreeFull()) {
            _createTree();
            trees[_currentTreeNumber].insert(newLeaf);
        } else {
            uint256 oldRoot = root();
            trees[_currentTreeNumber].insert(newLeaf);
            _pastRoots[_currentTreeNumber][oldRoot] = block.number;
        }
        _leaf[accountId] = newLeaf;
        emit Register(_currentTreeNumber, trees[_currentTreeNumber].numberOfLeaves - 1, accountId, newLeaf);
    }

    function _update(
        uint256 treeNumber,
        uint256 accountId,
        uint256 oldLeaf,
        uint256 newLeaf,
        bytes calldata merkleProof
    ) internal {
        (
            uint256[] memory merkleProofSiblings,
            uint8[] memory merkleProofPathIndices
        ) = abi.decode(merkleProof, (uint256[], uint8[]));
        uint256 oldRoot = rootOf(treeNumber);
        uint256 index = trees[treeNumber].update(oldLeaf, newLeaf, merkleProofSiblings, merkleProofPathIndices);
        _pastRoots[treeNumber][oldRoot] = block.number;
        _leaf[accountId] = newLeaf;
        emit Update(treeNumber, index, accountId, oldLeaf, newLeaf);
    }

    function _hashAccountData(AccountData calldata data)
        internal
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                ACCOUNT_TYPE_HASH,
                address(data.account),
                uint256(data.root),
                uint256(data.quorum),
                uint256(data.registry),
                keccak256(bytes(data.merkleProof)),
                uint256(data.nonce)
            )
        );
        return _hashTypedDataV4(structHash);
    }

    function _isValidSignature(
        address account,
        bytes32 digest,
        bytes memory signature
    ) internal view returns (bool) {
        return SignatureChecker.isValidSignatureNow(account, digest, signature);
    }
}