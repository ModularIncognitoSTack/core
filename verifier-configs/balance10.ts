import { VerifyingKey } from "../utils/types";
import { formatVerifyingKey } from "./utils";
import vks from "./verifying-keys/balance_10.json"


export interface BalVK {
    ins: number | bigint,
    vk: VerifyingKey
}


export const balVKDatas: BalVK[] = vks.map((vk: any) => {
    return {
        ins: vk.ins,
        vk: formatVerifyingKey(vk.vk)
    }
})