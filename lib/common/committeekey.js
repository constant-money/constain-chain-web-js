import { generateECDSAKeyPair } from "../privacy/ecdsa";
import { generateBLSKeyPair } from "../privacy/bls";
import { stringToBytes, convertUint8ArrayToArray } from "../privacy/utils";
import { checkEncode } from "./base58.js";
import { ENCODE_VERSION } from "./constants";
import { base64ArrayBuffer } from "./common";

// hashPrivateKey
async function generateCommitteeKeyFromHashPrivateKey(hashPrivateKeyBytes, publicKeyBytes) {
    let incPubKey = convertUint8ArrayToArray(publicKeyBytes);

    let blsKeyPair;
    try {
        blsKeyPair = await generateBLSKeyPair(hashPrivateKeyBytes);
    } catch (e) {
        throw e;
    }

    let ecdsaKeyPair = await generateECDSAKeyPair(hashPrivateKeyBytes);

    let miningPubKey = {
        "bls": base64ArrayBuffer(blsKeyPair.blsPublicKey),
        "dsa": base64ArrayBuffer(ecdsaKeyPair.ecdsaPublicKey)
    };

    let committeeKey = {
        IncPubKey: base64ArrayBuffer(incPubKey),
        MiningPubKey: miningPubKey,
    }

    // JSON marshal commiteeKey
    let keyStr = JSON.stringify(committeeKey);
    let encodedKey = checkEncode(stringToBytes(keyStr), ENCODE_VERSION);

    return encodedKey;
}

// async function generateBLSKeyPair(seed) {
//     let blsKeyPair;
//     try{
//         blsKeyPair = await generateBLSKeyPair(seed);
//     } catch(e){
//         throw e;
//     }
//     return blsKeyPair;
// }

async function generateBLSPubKeyB58CheckEncodeFromSeed(seed) {
    let blsKeyPair = await generateBLSKeyPair(seed);
    let blsPublicKey = convertUint8ArrayToArray(blsKeyPair.blsPublicKey);
    return checkEncode(blsPublicKey, ENCODE_VERSION);
}

export {
    generateCommitteeKeyFromHashPrivateKey,
    generateBLSPubKeyB58CheckEncodeFromSeed,
};
