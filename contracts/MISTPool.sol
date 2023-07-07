// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;
pragma abicoder v2;

import { MerkleTree } from "./MerkleTree.sol";
import { SCALAR_FIELD } from "./libraries/VerifierStructs.sol";
import { IUTXOVerifier } from "@usemist/modules/interfaces/IUTXOVerifier.sol";
import { IBalanceVerifier } from "@usemist/modules/interfaces/IBalanceVerifier.sol";
import { IMISTRegistry } from "@usemist/modules/interfaces/IMISTRegistry.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IERC1155 } from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import { IERC1155Receiver } from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import { IMISTPool } from "@usemist/modules/interfaces/IMISTPool.sol";
import { DepositData, PreCommitment, ExtData, TokenData, TokenStandard, TransferType } from "@usemist/modules/libraries/PoolStructs.sol";


error InvalidTokenAddress();
error InvalidAmount();
error InvalidRecipient();
error InvalidTransferType();
error InvalidUTXORoot();
error NullifierAlreadySpent();
error InvalidRegistryRoot();
error InvalidProof();
error InvalidNotesLength();
error InvalidChainID();

/**
 * @title MIST Pool
 * @author geovgy
 * @notice MIST Pool is a UTXO-based protocol that enables transactions
 * of ERC20, ERC721, and ERC1155 tokens with privacy. Deposits into the pool
 * are universal for all addresses. Transfers and withdrawals rely on the
 * MIST Registry to determine authentication, access control and quorum for
 * signers transacting on behalf of their accounts.
 */
contract MISTPool is IMISTPool, MerkleTree, EIP712, ReentrancyGuard {
    address public immutable accountRegistry;
    address public utxoVerifier;
    address public assetVerifier;
    mapping(address => uint256) internal _nonce;

    string private constant SIGNING_DOMAIN = "MISTPool";
    string private constant SIGNATURE_VERSION = "1";
    
    bytes32 private constant DEPOSIT_TYPE_HASH = keccak256("DepositData(uint256 nonce,address sender,PreCommitment[] preCommitments)PreCommitment(uint256 receiverHash,bytes encryptedNote,TokenData tokenData)TokenData(uint8 standard,address token,uint256 identifier,uint256 amount)");
    bytes32 private constant TOKEN_TYPE_HASH = keccak256("TokenData(uint8 standard,address token,uint256 identifier,uint256 amount)");
    bytes32 private constant PRE_COMMITMENT_TYPE_HASH = keccak256("PreCommitment(uint256 receiverHash,bytes encryptedNote,TokenData tokenData)TokenData(uint8 standard,address token,uint256 identifier,uint256 amount)");

    event Commitment(
        uint256 indexed treeIndex,
        uint256 leafIndex,
        uint256 indexed commitment,
        bytes encryptedNote
    );

    event Nullifier(
        uint256 indexed treeIndex,
        uint256 nullifier
    );

    event Deposit(
        uint256 indexed treeIndex,
        address indexed from,
        address token,
        uint256 identifier,
        uint256 amount,
        uint256 commitment
    );

    event Transfer(
        uint256 indexed treeIndex,
        uint256[] commitments
    );

    event Withdraw(
        uint256 indexed treeIndex,
        address indexed to,
        address token,
        uint256 identifier,
        uint256 amount
    );

    constructor(address _accountRegistry, address _utxoVerifier, address _assetVerifier)
    EIP712(SIGNING_DOMAIN, SIGNATURE_VERSION) {
        accountRegistry = _accountRegistry;
        utxoVerifier = _utxoVerifier;
        assetVerifier = _assetVerifier;
    }

    function deposit(
        DepositData calldata depositData,
        bytes calldata signature
    ) external nonReentrant {
        // Check for valid deposit
        (bool valid, string memory message) = isValidDeposit(depositData, signature);
        require(valid, message);
        unchecked {
            ++_nonce[depositData.sender];
        }
        _deposit(depositData);
    }

    function transfer(
        bytes calldata proof,
        bytes calldata inputs,
        ExtData calldata extData
    ) external nonReentrant {
        if (extData.transferType != TransferType.Transfer) {
            revert InvalidTransferType();
        }
        _transact(proof, inputs, extData);
    }

    function withdraw(
        bytes calldata proof,
        bytes calldata inputs,
        ExtData calldata extData
    ) external nonReentrant {
        if (extData.transferType != TransferType.Withdrawal) {
            revert InvalidTransferType();
        }
        _transact(proof, inputs, extData);
    }

    function getNonce(address account) public view returns (uint256) {
        return _nonce[account];
    }

    function getNullifyingKey() external pure returns (uint256) {
        return NULLIFYING_KEY;
    }

    function verifyBalanceOf(
        address token,
        uint256 minAmount,
        uint256 root,
        uint256 registry,
        uint256[] memory nullifiers,
        bytes calldata proof
    ) external view returns (bool) {
        // Check that the roots are correct
        require(_rootExists(root, _currentTreeIndex), "Invalid root");
        require(
            IMISTRegistry(accountRegistry).isValidRoot(registry),
            "Invalid registry root"
        );
        // Check that the nullifiers have not already been used
        for (uint i=0; i < nullifiers.length; i = _increment(i, 1)) {
            require(!_isSpent(nullifiers[i]), "Nullifier already spent");
        }
        // Check that the proof is valid
        return IBalanceVerifier(assetVerifier).verify(
            root,
            registry,
            token,
            minAmount,
            NULLIFYING_KEY,
            nullifiers,
            proof
        );
    }

    function _deposit(DepositData calldata depositData) internal {
        for (uint i; i < depositData.preCommitments.length; i = _increment(i, 1)) {
            // Transfer tokens
            _transferTokens(address(this), depositData.sender, depositData.preCommitments[i].tokenData);
            // Get commitment
            uint256 commitment = _hashCommitment(
                depositData.preCommitments[i].receiverHash,
                depositData.preCommitments[i].tokenData.token,
                depositData.preCommitments[i].tokenData.identifier,
                depositData.preCommitments[i].tokenData.amount
            );
            // Insert commitment to Merkle Tree
            if(_isMerkleTreeFull()) {
                unchecked { ++_currentTreeIndex; }
                _createTree();
            }
            _insert(commitment);
            // Emit events
            emit Commitment(
                _currentTreeIndex,
                _currentLeafIndex - 1,
                commitment,
                depositData.preCommitments[i].encryptedNote
            );
            emit Deposit(
                _currentTreeIndex,
                depositData.sender,
                depositData.preCommitments[i].tokenData.token,
                depositData.preCommitments[i].tokenData.identifier,
                depositData.preCommitments[i].tokenData.amount,
                commitment
            );
        }
    }

    function _transact(
        bytes calldata proof,
        bytes calldata inputs,
        ExtData calldata extData
    ) internal {
        if (extData.chainId != block.chainid) revert InvalidChainID();
        // Decode inputs
        (
            uint256 root,
            uint256 registryRoot,
            uint256 registryTreeIndex,
            uint256 quorum,
            uint256[] memory nullifiers,
            uint256[] memory commitments,
            bytes[] memory notes
        ) = abi.decode(
            inputs,
            (uint256, uint256, uint256, uint256, uint256[], uint256[], bytes[])
        );
        // Check that the roots are correct
        if (!_rootExists(root, extData.treeIndex)) revert InvalidUTXORoot();
        if (!IMISTRegistry(accountRegistry).isValidRoot(registryTreeIndex, registryRoot)) {
            revert InvalidRegistryRoot();
        }
        // Check that the nullifiers have not already been used
        for (uint i=0; i < nullifiers.length; i = _increment(i, 1)) {
            if (_isSpent(nullifiers[i])) revert NullifierAlreadySpent();
        }
        // Check notes length equals commitments length
        if (notes.length != commitments.length) revert InvalidNotesLength();
        // Get external data hash
        uint256 extDataHash = uint256(keccak256(abi.encode(extData))) % SCALAR_FIELD;
        // Hash and add commitment for withdrawal
        if (extData.transferType == TransferType.Withdrawal) {
            _validateExtData(extData);
            uint256 hashedCommitment = _hashCommitment(
                uint256(keccak256(abi.encode(extData.account))),
                extData.tokenData.token,
                extData.tokenData.identifier,
                extData.tokenData.amount
            );
            uint256[] memory newCommitments = new uint256[](commitments.length + 1);
            for (uint i=0; i < commitments.length; i = _increment(i, 1)) {
                newCommitments[i] = commitments[i];
            }
            newCommitments[commitments.length] = hashedCommitment;
            // Verify proof
            if (!_verifyProof(proof, root, registryRoot, extDataHash, quorum, nullifiers, newCommitments)) {
                revert InvalidProof();
            }
        } else {
            // Verify proof
            if (!_verifyProof(proof, root, registryRoot, extDataHash, quorum, nullifiers, commitments)) {
                revert InvalidProof();
            }
        }
        // Mark nullifiers as spent
        for (uint i=0; i < nullifiers.length; i = _increment(i, 1)) {
            _nullifiers[_currentTreeIndex][nullifiers[i]] = true;
        }
        // Insert commitments to Merkle Tree
        if(_isMerkleTreeFull()) {
            unchecked { _currentTreeIndex++; }
            _createTree();
        }
        uint256 startLeafIndex = _currentLeafIndex;
        _bulkInsert(commitments);
        // Transfer tokens
        // Only if transfer type is withdrawal
        if (extData.transferType == TransferType.Withdrawal) {
            _transferTokens(extData.account, address(this), extData.tokenData);
            emit Withdraw(
                _currentTreeIndex,
                extData.account,
                extData.tokenData.token,
                extData.tokenData.identifier,
                extData.tokenData.amount
            );
        } else {
            emit Transfer(
                _currentTreeIndex,
                commitments
            );
        }
        // Emit events
        for(uint i = 0; i < commitments.length; i = _increment(i, 1)) {
            emit Commitment(
                _currentTreeIndex,
                startLeafIndex + i,
                commitments[i],
                notes[i]
            );
        }
        for(uint i = 0; i < nullifiers.length; i = _increment(i, 1)) {
            emit Nullifier(_currentTreeIndex, nullifiers[i]);
        }
    }

    function _transferTokens(
        address to,
        address from,
        TokenData memory tokenData
    ) internal {
        if (tokenData.standard == TokenStandard.ERC20) {
            IERC20 token = IERC20(tokenData.token);
            if (from == address(this)) {
                token.transfer(to, tokenData.amount);
            } else {
                token.transferFrom(from, to, tokenData.amount);
            }
        } else if (tokenData.standard == TokenStandard.ERC721) {
            IERC721 token = IERC721(tokenData.token);
            token.safeTransferFrom(from, to, tokenData.identifier);
        } else if (tokenData.standard == TokenStandard.ERC1155) {
            IERC1155 token = IERC1155(tokenData.token);
            token.safeTransferFrom(from, to, tokenData.identifier, tokenData.amount, "");
        }
    }

    function _hashDepositData(DepositData calldata depositData)
        internal
        view
        returns (bytes32)
    {
        bytes32[] memory precommitments = new bytes32[](depositData.preCommitments.length);
        for (uint i; i < depositData.preCommitments.length; i = _increment(i, 1)) {
            precommitments[i] = keccak256(
                abi.encode(
                    PRE_COMMITMENT_TYPE_HASH,
                    uint256(depositData.preCommitments[i].receiverHash),
                    keccak256(bytes(depositData.preCommitments[i].encryptedNote)),
                    keccak256(
                        abi.encode(
                            TOKEN_TYPE_HASH,
                            uint8(depositData.preCommitments[i].tokenData.standard),
                            address(depositData.preCommitments[i].tokenData.token),
                            uint256(depositData.preCommitments[i].tokenData.identifier),
                            uint256(depositData.preCommitments[i].tokenData.amount)
                        )
                    )
                )
            );
        }

        bytes32 STRUCT_HASH = keccak256(
            abi.encode(
                DEPOSIT_TYPE_HASH,
                uint256(depositData.nonce),
                address(depositData.sender),
                keccak256(abi.encodePacked(precommitments))
            )
        );
        return _hashTypedDataV4(STRUCT_HASH);
    }

    function isValidDeposit(
        DepositData calldata depositData,
        bytes calldata signature
    ) public view returns (bool, string memory) {
        if (depositData.nonce != getNonce(depositData.sender)) {
            return (false, "Invalid nonce");
        }
        if (depositData.sender != msg.sender) {
            if (!_isValidSignature(depositData.sender, _hashDepositData(depositData), signature)) {
                return (false, "Invalid signature");
            }
        }
        return (true, "");
    }

    function _validateExtData(ExtData calldata extData) internal pure {
        if (extData.tokenData.token == address(0)) {
            revert InvalidTokenAddress();
        }
        if (extData.tokenData.amount == 0) {
            revert InvalidAmount();
        }
        if (extData.account == address(0)) {
            revert InvalidRecipient();
        }
    }

    function _isValidSignature(
        address account,
        bytes32 digest,
        bytes memory signature
    ) internal view returns (bool) {
        return SignatureChecker.isValidSignatureNow(account, digest, signature);
    }

    function _verifyProof(
        bytes calldata proof,
        uint256 root,
        uint256 registryRoot,
        uint256 extDataHash,
        uint256 quorum,
        uint256[] memory nullifiers,
        uint256[] memory commitments
    ) internal view returns (bool) {
        return IUTXOVerifier(utxoVerifier).verifyProof(
            proof,
            root,
            registryRoot,
            extDataHash,
            NULLIFYING_KEY,
            quorum,
            nullifiers,
            commitments
        );
    }

    function _increment(uint256 value, uint256 amount) internal pure returns (uint256) {
        unchecked { return value + amount; }
    }

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }
}