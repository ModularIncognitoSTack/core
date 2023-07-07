// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import { Pairing } from "./Pairing.sol";

uint256 constant SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

struct VerifyingKey {
    Pairing.G1Point alfa1;
    Pairing.G2Point beta2;
    Pairing.G2Point gamma2;
    Pairing.G2Point delta2;
    Pairing.G1Point[] IC;
}

struct Proof {
    Pairing.G1Point A;
    Pairing.G2Point B;
    Pairing.G1Point C;
}

struct RawProof {
    uint256[2] a;
    uint256[2][2] b;
    uint256[2] c;
}