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
    BIP44_COIN_TYPE,
} from './constants';
import {
    addChecksumToBytes
} from './utils';
import {
    byteToHexString,
} from '../common/common';
import {
    checkEncode,
    checkSumFirst4Bytes,
    checkDecode
} from '../common/base58';
import bn from "bn.js";
import hdkey from 'hdkey';
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

async function NewKey(seed, index = 0, depth = -1) {
    const hdKey = hdkey.fromMasterSeed(seed);

    const childHdKey = hdKey.derive(`m/44'/${BIP44_COIN_TYPE}'/0'/0/${index}`);
    const incognitoKeySet = new KeySet();
    await incognitoKeySet.generateKey(childHdKey.privateKey);

    const incognitoChildKey = new KeyWallet();
    incognitoChildKey.ChildNumber = (new bn(index)).toArray("be", ChildNumberSize);
    incognitoChildKey.ChainCode = childHdKey.chainCode;
    incognitoChildKey.Depth = depth + 1;
    incognitoChildKey.KeySet = incognitoKeySet;

    return incognitoChildKey;
}

export {
    KeyWallet,
    base58CheckDeserialize,
    NewKey,
};
