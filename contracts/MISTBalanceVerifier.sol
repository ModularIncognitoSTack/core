// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;
pragma abicoder v2;

import { Pairing } from "./libraries/Pairing.sol";
import { VerifyingKey, Proof, SCALAR_FIELD } from "./libraries/VerifierStructs.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IBalanceVerifier } from "@usemist/modules/interfaces/IBalanceVerifier.sol";

/**
 * @title MIST Balance Verifier
 * @author geovgy
 * @notice MIST Balance Verifier is a contract that verifies zk-SNARK proofs for the MIST Pool.
 * It verifies an account's proof of a given minimum balance of a token within the MIST Pool 
 * without revealing the account or the specific amount owned by that account. It is modified to 
 * allow for multiple verifying keys to be used for different number of inputs.
 */
contract MISTBalanceVerifier is IBalanceVerifier, Ownable {
    using Pairing for *;

    event SetVerifyingKey(
        uint256 ins,
        VerifyingKey vk
    );

    // ins (# of nullifiers) => VerifyingKey
    mapping(uint256 => VerifyingKey) internal _verifyingKeys;

    function verify(
        uint root,
        uint registryRoot,
        address token,
        uint balance,
        uint nullifyingKey,
        uint[] memory nullifiers,
        bytes calldata proof
    ) external view returns (bool r) {
        uint[] memory input = new uint[](nullifiers.length + 5);
        //root, registryRoot, token, balance, nullifiers
        input[0] = root;
        input[1] = registryRoot;
        input[2] = uint256(uint160(token));
        input[3] = balance;
        for(uint i = 0; i < nullifiers.length; i++){
            input[i + 4] = nullifiers[i];
        }
        input[input.length - 1] = nullifyingKey;
        return _verifyProof(
            proof, 
            input, 
            nullifiers.length
        );
    }

    /// @return r  bool true if proof is valid
    function _verifyProof(
        bytes calldata proof,
        uint[] memory input,
        uint256 ins
    ) internal view returns (bool r) {
        if (_verify(input, ins, _decodeProof(proof)) == 0) {
            return true;
        } else {
            return false;
        }
    }

    function setVerifyingKey(
        uint256 ins,
        VerifyingKey calldata vk
    ) external onlyOwner {
        _verifyingKeys[ins] = vk;
    }

    function setVerifyingKeys(
        uint256[] calldata ins,
        VerifyingKey[] calldata vks
    ) external onlyOwner {
        require(ins.length == vks.length, "verifier-bad-input");
        for (uint i = 0; i < ins.length; i = _increment(i, 1)) {
            _verifyingKeys[ins[i]] = vks[i];
            emit SetVerifyingKey(ins[i], vks[i]);
        }
    }
    
    function _increment(uint256 value, uint256 amount) internal pure returns (uint256) {
        unchecked { return value + amount; }
    }
    
    function _decodeProof(bytes calldata proof) pure internal returns (Proof memory) {
        (Proof memory p) = abi.decode(proof, (Proof));
        return p;
    }

    function _getVerifyingKey(uint256 ins) internal view returns (VerifyingKey memory vk) {
        return _verifyingKeys[ins];
    }

    function _verify(
        uint[] memory input,
        uint256 ins,
        Proof memory proof
    ) internal view returns (uint) {
        VerifyingKey memory vk = _getVerifyingKey(ins);
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