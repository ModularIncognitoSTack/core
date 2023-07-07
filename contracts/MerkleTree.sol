// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;
pragma abicoder v2;

import { IncrementalTreeData, IncrementalBinaryTree } from "./libraries/IncrementalBinaryTree.sol";
import { PoseidonT3 } from "poseidon-solidity/PoseidonT3.sol";
import { PoseidonT5 } from "poseidon-solidity/PoseidonT5.sol";
import { SCALAR_FIELD } from "./libraries/VerifierStructs.sol";


/**
 * @title MIST Merkle Tree
 * @author geovgy
 * @dev MIST Merkle Tree is an abstract contract that stores the Merkle Tree for the MIST Pool.
 */
abstract contract MerkleTree {
    using IncrementalBinaryTree for IncrementalTreeData;
    mapping(uint256 => IncrementalTreeData) internal _merkleTrees;
    uint256 internal constant TREE_DEPTH = 20;
    uint256 internal _currentTreeIndex;
    uint256 internal _currentLeafIndex;
    // Merkle tree => nullifier => spent
    mapping(uint256 => mapping(uint256 => bool)) internal _nullifiers;
    // Merkle tree => root => exists
    mapping(uint256 => mapping(uint256 => bool)) internal _rootHistory;

    uint256 internal constant NULLIFYING_KEY = uint256(keccak256("nullifier")) % SCALAR_FIELD;

    constructor() {
        _createTree();
    }

    function _createTree() internal {
        uint256 zeroValue = uint256(keccak256(abi.encodePacked(_currentTreeIndex))) >> 8;
        _merkleTrees[_currentTreeIndex].init(TREE_DEPTH, zeroValue);
        _rootHistory[_currentTreeIndex][_merkleTrees[_currentTreeIndex].root] = true;
        _currentLeafIndex = 0;
    }

    function _insert(uint256 leaf) internal {
        require(_merkleTrees[_currentTreeIndex].depth > 0, "Tree does not exist");
        _merkleTrees[_currentTreeIndex].insert(leaf);
        _rootHistory[_currentTreeIndex][_merkleTrees[_currentTreeIndex].root] = true;
        unchecked {
            ++_currentLeafIndex;
        }
    }

    function _bulkInsert(uint256[] memory leaves) internal {
        require(_merkleTrees[_currentTreeIndex].depth > 0, "Tree does not exist");
        for (uint i=0; i<leaves.length; i++) {
            _merkleTrees[_currentTreeIndex].insert(leaves[i]);
            _rootHistory[_currentTreeIndex][_merkleTrees[_currentTreeIndex].root] = true;
        }
        unchecked {
            _currentLeafIndex += leaves.length;
        }
    }

    function _hashLeftRight(uint256 left, uint256 right) internal pure returns (uint256) {
        return PoseidonT3.hash([left, right]);
    }

    function _hashCommitment(
        uint256 accountHash,
        address tokenAddress,
        uint256 identifier,
        uint256 amount
    ) internal pure returns (uint256) {
        return PoseidonT5.hash([accountHash, uint256(uint160(tokenAddress)), identifier, amount]);
    }

    function _isMerkleTreeFull() internal view returns (bool) {
        return _merkleTrees[_currentTreeIndex].numberOfLeaves == 2**TREE_DEPTH;
    }

    function _isSpent(uint256 nullifier) internal view returns (bool) {
        return _nullifiers[_currentTreeIndex][nullifier];
    }

    function _rootExists(uint256 root, uint256 treeIndex) internal view returns (bool) {
        return _rootHistory[treeIndex][root];
    }

    function getMerkleTreeIndex() public view returns (uint256) {
        return _currentTreeIndex;
    }

    function getCurrentMerkleRoot() public view returns (uint256) {
        return _merkleTrees[_currentTreeIndex].root;
    }
}