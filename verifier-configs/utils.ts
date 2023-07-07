import { VerifyingKey } from "../utils/types";

export function formatVerifyingKey(vk: any): VerifyingKey {
    return {
        alfa1: {
            X: BigInt(vk.alfa1.X),
            Y: BigInt(vk.alfa1.Y)
        },
        beta2: {
            X: [BigInt(vk.beta2.X[0]), BigInt(vk.beta2.X[1])],
            Y: [BigInt(vk.beta2.Y[0]), BigInt(vk.beta2.Y[1])]
        },
        gamma2: {
            X: [BigInt(vk.gamma2.X[0]), BigInt(vk.gamma2.X[1])],
            Y: [BigInt(vk.gamma2.Y[0]), BigInt(vk.gamma2.Y[1])]
        },
        delta2: {
            X: [BigInt(vk.delta2.X[0]), BigInt(vk.delta2.X[1])],
            Y: [BigInt(vk.delta2.Y[0]), BigInt(vk.delta2.Y[1])]
        },
        IC: vk.IC.map((ic: any) => {
            return {
                X: BigInt(ic.X),
                Y: BigInt(ic.Y)
            }
        })
    }
}