export interface G1Point {
    X: bigint;
    Y: bigint;
}

export interface G2Point {
    X: [bigint, bigint];
    Y: [bigint, bigint];
}

export interface RawProof {
    a: [bigint, bigint];
    b: [[bigint, bigint], [bigint, bigint]];
    c: [bigint, bigint];
}

export interface Proof {
    A: G1Point;
    B: G2Point;
    C: G1Point;
}

export interface VerifyingKey {
    alfa1: G1Point;
    beta2: G2Point;
    gamma2: G2Point;
    delta2: G2Point;
    IC: G1Point[];
}

export interface VKData {
    ins: number
    outs: number
    quorum: number
    vk: VerifyingKey
}