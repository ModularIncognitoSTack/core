import { VKData, VerifyingKey } from "../utils/types";
import { formatVerifyingKey } from "./utils";
import vks from "./verifying-keys/utxo_mfa_10.json"


export const vkDatas: VKData[] = vks.map((vk: any) => {
    return {
        ins: vk.ins,
        outs: vk.outs,
        quorum: vk.quorum,
        vk: formatVerifyingKey(vk.vk)
    }
})