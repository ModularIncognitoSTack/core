// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;
pragma abicoder v2;

import { Pairing } from "./libraries/Pairing.sol";
import { VerifyingKey, Proof, SCALAR_FIELD } from "./libraries/VerifierStructs.sol";
import { IAccountVerifier } from "@usemist/modules/interfaces/IAccountVerifier.sol";

/**
 * @title MIST Account Verifier
 * @author geovgy
 * @notice MIST Account Verifier is a contract that verifies zk-SNARK proofs for the MIST Registry.
 * It verifies membership of a signer within an account without revealing the signer.
 */
contract MISTAccountVerifier is IAccountVerifier {
    using Pairing for *;

    function _verifyingKey() internal pure returns (VerifyingKey memory vk) {
        vk.alfa1 = Pairing.G1Point(
            10771514739109476212537494967070498831771100370523309695301503273804100444853,
            14532488961610246966560211589985278403655662761545182199468806640717159113694
        );

        vk.beta2 = Pairing.G2Point(
            [4026056755630746147953610818487021226224195495085524800002945816434556540988,
             15723325080462309297325250168146829743589115247658379145253109985419187375146],
            [2254368839249458752159907094840228665495389223599956770202421872925947208237,
             10869989448304202253827755680849041411429684613830109534338569627702995303747]
        );
        vk.gamma2 = Pairing.G2Point(
            [11559732032986387107991004021392285783925812861821192530917403151452391805634,
             10857046999023057135944570762232829481370756359578518086990519993285655852781],
            [4082367875863433681332203403145435568316851327593401208105741076214120093531,
             8495653923123431417604973247489272438418190587263600148770280649306958101930]
        );
        vk.delta2 = Pairing.G2Point(
            [11559732032986387107991004021392285783925812861821192530917403151452391805634,
             10857046999023057135944570762232829481370756359578518086990519993285655852781],
            [4082367875863433681332203403145435568316851327593401208105741076214120093531,
             8495653923123431417604973247489272438418190587263600148770280649306958101930]
        );
        vk.IC = new Pairing.G1Point[](4);
        
        vk.IC[0] = Pairing.G1Point( 
            17564630180784432145571433692040755300076023084757713092761605392076936268820,
            9542142769970159733792904387528508839315833499832577131239598921600563172017
        );                                      
        
        vk.IC[1] = Pairing.G1Point( 
            18280709549376678304976579909090386556773560165966871205428422318065869958887,
            5838009290427912198481368040790641176678887039834061395096957074232348804563
        );                                      
        
        vk.IC[2] = Pairing.G1Point( 
            828156987480087272516239203944029948311069063836289137346074406185639914493,
            8066972715591954643840184854449891029190305328081703453388536164903926555433
        );                                      
        
        vk.IC[3] = Pairing.G1Point( 
            13986041371374313737345556904227354419578376113969039035674247607766414850007,
            16406474973278918200139897715595240047813305279655702898102182531342696270472
        );                                      
        
    }
    
    function _verify(uint[] memory input, Proof memory proof) internal view returns (uint) {
        VerifyingKey memory vk = _verifyingKey();
        require(input.length + 1 == vk.IC.length,"verifier-bad-input");
        // Compute the linear combination vk_x
        Pairing.G1Point memory vk_x = Pairing.G1Point(0, 0);
        for (uint i = 0; i < input.length; i++) {
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

    function _verifyProof(uint256[] memory inputs, Proof memory proof) internal view returns (bool) {
        if (_verify(inputs, proof) == 0) {
            return true;
        } else {
            return false;
        }
    }

    /// @return r  bool true if proof is valid
    function verifyProof(
        uint[2] memory a,
        uint[2][2] memory b,
        uint[2] memory c,
        uint[3] memory input
    ) public view returns (bool r) {
        Proof memory proof;
        proof.A = Pairing.G1Point(a[0], a[1]);
        proof.B = Pairing.G2Point([b[0][0], b[0][1]], [b[1][0], b[1][1]]);
        proof.C = Pairing.G1Point(c[0], c[1]);
        uint[] memory inputValues = new uint[](input.length);
        for(uint i = 0; i < input.length; i++){
            inputValues[i] = input[i];
        }
        r = _verifyProof(inputValues, proof);
    }

    function verifyProof(
        bytes calldata proof,
        uint root,
        uint message,
        uint role
    ) external view returns (bool r) {
        uint[] memory input = new uint[](3);
        (Proof memory p) = abi.decode(proof, (Proof));
        input[0] = root;
        input[1] = message;
        input[2] = role;
        r = _verifyProof(input, p);
    }
}
