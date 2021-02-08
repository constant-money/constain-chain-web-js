import {
    KeySet
} from '../common/keySet';
import {
    PriKeyType,
    PriKeySerializeSize,
    PaymentAddressType,
    PaymentAddrSerializeSize,
    ReadonlyKeyType,
    ReadonlyKeySerializeSize,
    OTAKeyType,
    OTAKeySerializeSize,
    ChildNumberSize,
    ChainCodeSize,
    PriKeySerializeAddCheckSumSize,
    PaymentAddrSerializeAddCheckSumSize,
    ReadonlyKeySerializeAddCheckSumSize,
} from './constants';
import {
    addChecksumToBytes
} from './utils';
import {
    byteToHexString,
    getShardIDFromLastByte
} from '../common/common';
import {
    checkEncode,
    checkSumFirst4Bytes,
    checkDecode
} from '../common/base58';
let c =
    import ("crypto-js");
import bn from "bn.js";
import {
    ENCODE_VERSION,
    ED25519_KEY_SIZE
} from "../common/constants";
import {
    generateBLSPubKeyB58CheckEncodeFromSeed
} from "../common/committeekey";
import {
    hashSha3BytesToBytes
} from "../privacy/utils";

let deserialize = (bytes) => {
    let key = new KeyWallet();

    // get key type
    let keyType = bytes[0];

    if (keyType === PriKeyType) {
        // if (bytes.length != PriKeySerializeAddCheckSumSize) {
        //   throw new error("invalid private key");
        // }
        key.Depth = bytes[1];
        key.ChildNumber = bytes.slice(2, 6);
        key.ChainCode = bytes.slice(6, 38);
        let keyLength = bytes[38];

        key.KeySet.PrivateKey = bytes.slice(39, 39 + keyLength);

    } else if (keyType === PaymentAddressType) {

        let PublicKeyLength = bytes[1];
        key.KeySet.PaymentAddress.Pk = bytes.slice(2, 2 + PublicKeyLength);

        let TransmisionKeyLength = bytes[PublicKeyLength + 2];
        key.KeySet.PaymentAddress.Tk = bytes.slice(PublicKeyLength + 3, PublicKeyLength + 3 + TransmisionKeyLength);
        if (bytes.length > PaymentAddrSerializeSize) {
            key.KeySet.PaymentAddress.OTAPublic = bytes.slice(PaymentAddrSerializeSize + 1, PaymentAddrSerializeSize + 33)
        }
    } else if (keyType === ReadonlyKeyType) {
        // if (bytes.length != ReadonlyKeySerializeAddCheckSumSize) {
        //   throw new error("invalid read-only key");
        // }
        let PublicKeyLength = bytes[1];
        key.KeySet.ReadonlyKey.Pk = bytes.slice(2, 2 + PublicKeyLength);

        let ReceivingKeyLength = bytes[PublicKeyLength + 2];
        key.KeySet.ReadonlyKey.Rk = bytes.slice(PublicKeyLength + 3, PublicKeyLength + 3 + ReceivingKeyLength);
    }

    // validate checksum
    let cs1 = checkSumFirst4Bytes(bytes.slice(0, bytes.length - 4));
    let cs2 = bytes.slice(bytes.length - 4);

    if (!cs1.equals(cs2)) {
        throw error("Checksum wrong!!!")
    }

    return key;
}

let base58CheckDeserialize = (str) => {
    let bytes;
    try {
        bytes = checkDecode(str).bytesDecoded;
    } catch (e) {
        throw e;
    }

    return deserialize(bytes);
}

let getKeySetFromPrivateKeyStr = async (privateKeyStr) => {
    let kw;
    try {
        kw = base58CheckDeserialize(privateKeyStr);
    } catch (e) {
        throw e;
    }

    await kw.KeySet.importFromPrivateKey(kw.KeySet.PrivateKey);
    let paymentAddressStr = kw.base58CheckSerialize(PaymentAddressType);

    return {
        PaymentAddress: paymentAddressStr,
        ShardID: getShardIDFromLastByte(kw.KeySet.PaymentAddress.Pk[(kw.KeySet.PaymentAddress.Pk.length - 1)])
    }
}

class KeyWallet {
    constructor() {
        this.Depth = 0; // 1 byte
        this.ChildNumber = new Uint8Array(ChildNumberSize); // 4 bytes
        this.ChainCode = new Uint8Array(ChainCodeSize); // 32 bytes
        this.KeySet = new KeySet();
    }

    async fromPrivateKey(privateKey) {
        this.Depth = 0; // 1 byte
        this.ChildNumber = new Uint8Array(ChildNumberSize); // 4 bytes
        this.ChainCode = new Uint8Array(ChainCodeSize); // 32 bytes
        this.KeySet = new KeySet();
        await this.KeySet.importFromPrivateKey(privateKey);
        // console.log("HDWALLET LOADED", JSON.stringify(keyWallet.KeySet));
        return this;
    }

    async newChildKey(childIdx) {
        let intermediary = this.getIntermediary(childIdx);
        let newSeed = intermediary.slice(0, 32);
        let newKeySet = new KeySet();
        await newKeySet.generateKey(newSeed);

        let childKey = new KeyWallet();
        childKey.ChildNumber = (new bn(childIdx)).toArray("be", ChildNumberSize);
        childKey.ChainCode = intermediary.slice(ChainCodeSize);
        childKey.Depth = this.Depth + 1;
        childKey.KeySet = newKeySet;
        return childKey;
    }

    getIntermediary(childIdx) {
        let childIndexBytes = (new bn(childIdx)).toArray();
        let chainCode = this.ChainCode;
        // HmacSHA512(data, key)
        return c.then(CryptoJS => {
            let hmac = CryptoJS.HmacSHA512(CryptoJS.enc.Base64.stringify(byteArrayToWordArray(chainCode)), byteArrayToWordArray(childIndexBytes));
            let intermediary = wordArrayToByteArray(hmac)
            return intermediary;
        })
    }

    // Serialize a KeySet to a 78 byte byte slice
    serialize(keyType) {
        // Write fields to buffer in order
        let keyBytes;

        if (keyType === PriKeyType) {
            keyBytes = new Uint8Array(PriKeySerializeSize);
            let offset = 0;
            keyBytes.set([keyType], offset);
            offset += 1;

            keyBytes.set([this.Depth], offset);
            offset += 1;

            keyBytes.set(this.ChildNumber, offset);
            offset += ChildNumberSize;

            keyBytes.set(this.ChainCode, offset);
            offset += ChainCodeSize;

            keyBytes.set([this.KeySet.PrivateKey.length], offset);
            offset += 1;
            keyBytes.set(this.KeySet.PrivateKey, offset);

        } else if (keyType === PaymentAddressType) {
            keyBytes = new Uint8Array(PaymentAddrSerializeSize);
            if (this.KeySet.PaymentAddress.OTAPublic.length > 0) {
                keyBytes = new Uint8Array(PaymentAddrSerializeSize + 1 + ED25519_KEY_SIZE);
                keyBytes.set([this.KeySet.PaymentAddress.OTAPublic.length], PaymentAddrSerializeSize) // set length OTAPublicKey
                keyBytes.set(this.KeySet.PaymentAddress.OTAPublic, PaymentAddrSerializeSize + 1) // set OTAPublicKey
            }
            let offset = 0;
            keyBytes.set([keyType], offset);
            offset += 1;

            keyBytes.set([this.KeySet.PaymentAddress.Pk.length], offset);
            offset += 1;
            keyBytes.set(this.KeySet.PaymentAddress.Pk, offset);
            offset += ED25519_KEY_SIZE;

            keyBytes.set([this.KeySet.PaymentAddress.Tk.length], offset);
            offset += 1;
            keyBytes.set(this.KeySet.PaymentAddress.Tk, offset);
            offset += ED25519_KEY_SIZE;



        } else if (keyType === ReadonlyKeyType) {
            keyBytes = new Uint8Array(ReadonlyKeySerializeSize);
            let offset = 0;
            keyBytes.set([keyType], offset);
            offset += 1;

            keyBytes.set([this.KeySet.ReadonlyKey.Pk.length], offset);
            offset += 1;
            keyBytes.set(this.KeySet.ReadonlyKey.Pk, offset);
            offset += ED25519_KEY_SIZE;

            keyBytes.set([this.KeySet.ReadonlyKey.Rk.length], offset);
            offset += 1;
            keyBytes.set(this.KeySet.ReadonlyKey.Rk, offset);
        } else if (keyType === OTAKeyType) {
            keyBytes = new Uint8Array(OTAKeySerializeSize);
            let offset = 0;
            keyBytes.set([keyType], offset);
            offset += 1;
            keyBytes.set([this.KeySet.OTAKey.Pk.length], offset);
            offset += 1;
            keyBytes.set(this.KeySet.OTAKey.Pk, offset);
            offset += ED25519_KEY_SIZE;
            keyBytes.set([this.KeySet.OTAKey.OTASecret.length], offset);
            offset += 1;
            keyBytes.set(this.KeySet.OTAKey.OTASecret, offset);
            offset += ED25519_KEY_SIZE;
        }

        // Append key bytes to the standard sha3 checksum
        return addChecksumToBytes(keyBytes);
    }

    base58CheckSerialize(keyType) {
        let serializedKey = this.serialize(keyType);
        return checkEncode(serializedKey, ENCODE_VERSION);
    }

    hexSerialize(keyType) {
        let serializedKey = this.serialize(keyType);
        return byteToHexString(serializedKey)
    }

    getPublicKeyByHex() {
        return byteToHexString(this.KeySet.PaymentAddress.Pk)
    }

    getPublicKeyCheckEncode() {
        return checkEncode(this.KeySet.PaymentAddress.Pk, ENCODE_VERSION);
    }

    getMiningSeedKey() {
        return hashSha3BytesToBytes(hashSha3BytesToBytes(this.KeySet.PrivateKey));
    }

    async getBLSPublicKeyB58CheckEncode() {
        let miningSeedKey = this.getMiningSeedKey();
        let blsPublicKey = await generateBLSPubKeyB58CheckEncodeFromSeed(miningSeedKey);
        return blsPublicKey;
    }

}

function NewMasterKey(seed) {
    // HmacSHA512(data, key)
    return c.then(CryptoJS => {
        let hmac = CryptoJS.HmacSHA512(CryptoJS.enc.Base64.stringify(byteArrayToWordArray(seed)), "Constant seed");
        let intermediary = wordArrayToByteArray(hmac);

        // Split it into our PubKey and chain code
        let keyBytes = intermediary.slice(0, 32) // use to create master private/public keypair
        let chainCode = intermediary.slice(32) // be used with public PubKey (in keypair) for new child keys
        let keySet = new KeySet();
        keySet.generateKey(keyBytes);

        let keyWallet = new KeyWallet();
        keyWallet.KeySet = keySet;
        keyWallet.ChainCode = chainCode;
        keyWallet.Depth = 0;
        keyWallet.ChildNumber = new Uint8Array([0, 0, 0, 0]);
        return keyWallet;
    })
}

function wordToByteArray(word, length) {
    var ba = [],
        i,
        xFF = 0xFF;
    if (length > 0)
        ba.push(word >>> 24);
    if (length > 1)
        ba.push((word >>> 16) & xFF);
    if (length > 2)
        ba.push((word >>> 8) & xFF);
    if (length > 3)
        ba.push(word & xFF);

    return ba;
}

function wordArrayToByteArray(wordArray, length) {
    if (wordArray.hasOwnProperty("sigBytes") && wordArray.hasOwnProperty("words")) {
        length = wordArray.sigBytes;
        wordArray = wordArray.words;
    }

    var result = [],
        bytes,
        i = 0;
    while (length > 0) {
        bytes = wordToByteArray(wordArray[i], Math.min(4, length));
        length -= bytes.length;
        result.push(bytes);
        i++;
    }
    return [].concat.apply([], result);
}

function byteArrayToWordArray(ba) {
    return c.then(CryptoJS => {
        var wa = [],
            i;
        for (i = 0; i < ba.length; i++) {
            wa[(i / 4) | 0] |= ba[i] << (24 - 8 * i);
        }

        return CryptoJS.lib.WordArray.create(wa, ba.length);
    })
}

export {
    KeyWallet,
    NewMasterKey,
    wordArrayToByteArray,
    wordToByteArray,
    byteArrayToWordArray,
    base58CheckDeserialize,
    getKeySetFromPrivateKeyStr
};