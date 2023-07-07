// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;
pragma abicoder v2;

import { Pairing } from "./libraries/Pairing.sol";
import { VerifyingKey, Proof, SCALAR_FIELD } from "./libraries/VerifierStructs.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IUTXOVerifier } from "@usemist/modules/interfaces/IUTXOVerifier.sol";

/**
 * @title MIST UTXO Verifier
 * @author geovgy
 * @notice MIST UTXO Verifier is a contract that verifies zk-SNARK proofs for the MIST Pool.
 * It verifies that a given set of nullifiers and commitments are valid for transactions in
 * the MIST Pool without revealing the sender, receiver, token nor amount (except on withdrawals).
 * It is modified to allow for multiple verifying keys to be used for different quorums and
 * different number of inputs and outputs.
 */
contract MISTUTXOVerifier is IUTXOVerifier, Ownable {
    using Pairing for *;

    struct VKData {
        uint256 ins;
        uint256 outs;
        uint256 quorum;
        VerifyingKey vk;
    }

    event SetVerifyingKey(
        uint256 ins,
        uint256 outs,
        uint256 quorum,
        VerifyingKey vk
    );

    // ins (# of nullifiers) => outs (# of commitment) => quorum => VerifyingKey
    mapping(uint256 => mapping(uint256 => mapping(uint256 => VerifyingKey))) internal _verifyingKeys;

    function verifyProof(
        bytes calldata proof,
        uint root,
        uint registryRoot,
        uint extDataHash,
        uint nullifyingKey,
        uint quorum,
        uint[] calldata nullifiers,
        uint[] calldata commitments
    ) external view returns (bool r) {
        uint[] memory input = new uint[](nullifiers.length + commitments.length + 4);
        input[0] = root;
        input[1] = registryRoot;
        input[2] = extDataHash;
        for(uint i = 0; i < nullifiers.length; i++){
            input[i + 3] = nullifiers[i];
        }
        for(uint i = 0; i < commitments.length; i++){
            input[i + 3 + nullifiers.length] = commitments[i];
        }
        input[input.length - 1] = nullifyingKey;
        return _verifyProof(
            proof, 
            input, 
            nullifiers.length,
            commitments.length,
            quorum
        );
    }

    /// @return r  bool true if proof is valid
    function _verifyProof(
        bytes calldata proof,
        uint[] memory input,
        uint256 ins,
        uint256 outs,
        uint256 quorum
    ) internal view returns (bool r) {
        if (_verify(input, ins, outs, quorum, _decodeProof(proof)) == 0) {
            return true;
        } else {
            return false;
        }
    }

    function setVerifyingKey(
        uint256 ins,
        uint256 outs,
        uint256 quorum,
        VerifyingKey calldata vk
    ) external onlyOwner {
        _verifyingKeys[ins][outs][quorum] = vk;
    }

    function setVerifyingKeys(
        VKData[] calldata vkData
    ) external onlyOwner {
        for (uint i = 0; i < vkData.length; i = _increment(i, 1)) {
            _verifyingKeys[vkData[i].ins][vkData[i].outs][vkData[i].quorum] = vkData[i].vk;
            emit SetVerifyingKey(vkData[i].ins, vkData[i].outs, vkData[i].quorum, vkData[i].vk);
        }
    }
    
    function _increment(uint256 value, uint256 amount) internal pure returns (uint256) {
        unchecked { return value + amount; }
    }
    
    function _decodeProof(bytes calldata proof) pure internal returns (Proof memory) {
        (Proof memory p) = abi.decode(proof, (Proof));
        return p;
    }

    function _getVerifyingKey(uint256 nullifiers, uint256 commitments, uint256 quorum) internal view returns (VerifyingKey memory vk) {
        return _verifyingKeys[nullifiers][commitments][quorum];
    }

    function _verify(
        uint[] memory input,
        uint256 ins,
        uint256 outs,
        uint256 quorum,
        Proof memory proof
    ) internal view returns (uint) {
        VerifyingKey memory vk = _getVerifyingKey(ins, outs, quorum);
        require(input.length + 1 == vk.IC.length,"verifier-bad-input");
        // Compute the linear combination vk_x
        Pairing.G1Point memory vk_x = Pairing.G1Point(0, 0);
        for (uint i = 0; i < input.length; i = _increment(i, 1)) {
            require(input[i] < SCALAR_FIELD,"verifier-gte-snark-scalar-field");
            vk_x = Pairing.addition(vk_x, Pairing.scalar_mul(vk.IC[i + 1], input[i]));
        }
        vk_x = Pairing.addition(vk_x, vk.IC[0]);
        if (!Pairing.pairingProd4(
            Pairing.negate(proof.A), proof.B,
            vk.alfa1, vk.beta2,
            vk_x, vk.gamma2,
            proof.C, vk.delta2
        )) return 1;
        return 0;
    }
}