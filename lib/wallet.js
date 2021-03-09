import CryptoJS from 'crypto-js';
import {
    KeySet
} from './common/keySet';
import {
    PaymentAddress,
    ViewingKey,
    OTAKey,
    PaymentInfo
} from './common/key';
import {
    RpcClient
} from"./rpcclient/rpcclient";
import {
    setRandBytesFunc,
    hashSha3BytesToBytes
} from "./privacy/utils";
import {
    FailedTx,
    SuccessTx,
    ConfirmedTx,
    MetaStakingBeacon,
    MetaStakingShard,
    PaymentAddressType,
    ReadonlyKeyType,
    PriKeyType,
    BurningRequestMeta,
    WithDrawRewardRequestMeta,
    PDEContributionMeta,
    PDEPRVRequiredContributionRequestMeta,
    PDETradeRequestMeta,
    PDECrossPoolTradeRequestMeta,
    PDEWithdrawalRequestMeta,
    PRVIDSTR,
    KeyWallet,
    TxHistoryInfo,
    toNanoPRV,
    toPRV,
    encryptMessageOutCoin,
    decryptMessageOutCoin,
} from "./core";
import {
    CustomTokenTransfer,
    CustomTokenInit,
    MAX_INPUT_PER_TX
} from './tx/constants';
import {
    checkEncode
} from "./common/base58";
import {
    getShardIDFromLastByte
} from "./common/common";
import {
	Transactor as AccountWallet
} from "./transactor";
import {
    generateECDSAKeyPair
} from "./privacy/ecdsa";
import {
    generateBLSKeyPair
} from "./privacy/bls";
import {
    ENCODE_VERSION,
    ED25519_KEY_SIZE
} from "./common/constants";
import {
    CustomError,
    ErrorObject
} from "./common/errorhandler";
import {
    generateBLSPubKeyB58CheckEncodeFromSeed
} from "./common/committeekey";
import {
    load
} from "./wasm/loader";
import { newSeed, validateMnemonic, newMnemonic } from './core/mnemonic';
import { NewKey } from './core/hdwallet';
import { hybridDecryption, hybridEncryption } from './privacy/hybridEncryption';
import { RPCHttpService } from './rpcclient/rpchttpservice';


const constants = {
    CustomTokenTransfer,
    MAX_INPUT_PER_TX,
};

export const getChildIdFromChildNumberArray = (array) => {
    let value = 0;
    for (let i = 0; i < array.length; i++) {
        value = (value * 256) + array[i];
    }

    return value;
};


class Wallet {
    constructor() {
        this.PassPhrase = '';
        this.Mnemonic = '';
        this.MasterAccount = null;
        this.Name = '';
        this.Storage = null;
        this.Seed = '';
    }

    NewTransactor(privateKey) {
        let t = new AccountWallet(this);
        return t.setKey(privateKey)
        .then(_ => {
            return t;
        })
    }

    async init(passPhrase, storage, walletName, accountName) {
        this.Name = walletName;
        this.Mnemonic = newMnemonic();
        this.PassPhrase = passPhrase;

        await this._generateMasterAccount();
        await this._generateFirstAccount(accountName);

        this.Storage = storage;
    }

    /**
     *
     * @param {string} mnemonic // Ex: "ability able about above absent absorb abstract absurd abuse access accident account"
     * @param {string} passPhrase
     * @param {string} name
     * @param {*} storage
     */
    async import(mnemonic, passPhrase, name, storage) {
        // check passphrase
        // if (this.PassPhrase !== passPhrase){
        //   throw new CustomError(ErrorObject.WrongPassPhraseErr, "Wrong passphrase when importing wallet");
        // }

        if (!validateMnemonic(mnemonic)) {
            throw new CustomError(ErrorObject.MnemonicInvalidErr, ErrorObject.MnemonicInvalidErr.description);
        }

        this.PassPhrase = passPhrase;
        this.Name = name;
        this.Mnemonic = mnemonic;

        await this._generateMasterAccount();
        await this._generateFirstAccount();

        this.Storage = storage;
    }

    async _generateMasterAccount() {
        this.Seed = newSeed(this.Mnemonic);
        const masterAccountKey = await NewKey(this.Seed, 0, -1);
        this.MasterAccount = new AccountWallet(this);
        this.MasterAccount.key = masterAccountKey;
        this.MasterAccount.child = [];
        this.MasterAccount.name = "master";

    }

    async _generateFirstAccount(accountName = 'Anon') {
        const account = await this.createAccountWithId(1, accountName);
        this.MasterAccount.child.push(account);
    }

    getAccountByName(accountName) {
        return this.MasterAccount.child.find(item => item.name === accountName)
    }

    getAccountIndexByName(accountName) {
        return this.MasterAccount.child.findIndex(item => item.name.toLowerCase() === accountName.toLowerCase())
    }

    async getCreatedAccounts(deserialize = true) {
        let createdAccounts = [];

        for (const account of this.MasterAccount.child) {
            const id = getChildIdFromChildNumberArray(account.key.ChildNumber);

            const newAccount = await this.createAccountWithId(id);

            const newPrivateKey = newAccount.key.base58CheckSerialize(PriKeyType);
            const oldPrivateKey = account.key.base58CheckSerialize(PriKeyType);

            if (newPrivateKey === oldPrivateKey) {
                createdAccounts.push(account);
            }
        }

        if (deserialize) {
            const deserializeCreatedAccounts = [];
            for (const account of createdAccounts) {
                const info = await account.getDeserializeInformation();
                deserializeCreatedAccounts.push(info);
            }

            createdAccounts = deserializeCreatedAccounts;
        }

        return createdAccounts;
    }

    async hasCreatedAccount(privateKey) {
        const accountName = 'Test';
        const newAccount = await this.createAccountWithPrivateKey(privateKey, accountName);
        const childId = await getChildIdFromChildNumberArray(newAccount.key.ChildNumber);

        const newAccountWithId = await this.createAccountWithId(childId, accountName);

        return (
          newAccountWithId.key.base58CheckSerialize(PriKeyType) === privateKey &&
          newAccountWithId.key.base58CheckSerialize(PriKeyType) === newAccount.key.base58CheckSerialize(PriKeyType)
        )
    }

    /**
     * Create and add account to wallet
     * @param accountName
     * @param shardID
     * @returns {*}
     */
    async createNewAccount(accountName, shardID = null, excludedIds) {
        const newAccount = await this.createAccount(accountName, shardID, excludedIds);
        this.MasterAccount.child.push(newAccount);
        this.save(this.PassPhrase);

        return newAccount;
    }

    async createAccount(accountName, shardID, excludedIds = []) {
        let childKey;

        const createdAccounts = await this.getCreatedAccounts(true);
        const createdIds = createdAccounts
          .map(item => item.ID);

        const possibleIds =
          createdIds.filter(id => !createdIds.includes(id + 1));

        let newId = possibleIds.length > 0 ? Math.min(...possibleIds) + 1 : 1;

        const createdPrivateKeys = createdAccounts.map(item => item.PrivateKey);

        while (true) {
            childKey = await NewKey(this.Seed, newId, 0);
            const newPrivateKey = childKey.base58CheckSerialize(PriKeyType);
            const lastByte = childKey.KeySet.PaymentAddress.Pk[childKey.KeySet.PaymentAddress.Pk.length - 1];
            const isExisted = createdPrivateKeys.includes(newPrivateKey);

            if (isExisted || (_.isNumber(shardID) && lastByte !== shardID) || excludedIds.includes(newId)) {
                newId++;
                continue;
            }

            const accountWallet = new AccountWallet(this);
            accountWallet.key = childKey;
            accountWallet.child = [];
            accountWallet.name = accountName || newId;

            return accountWallet;
        }
    }

    async createAccountWithPrivateKey(privakeyStr, accountName) {
        let keyWallet;
        try {
            keyWallet = KeyWallet.base58CheckDeserialize(privakeyStr)
        } catch (e) {
            throw new CustomError(ErrorObject.B58CheckDeserializedErr, "Can not base58 check deserialized private key of importing account");;
        }

        if (keyWallet.KeySet.PrivateKey.length !== ED25519_KEY_SIZE) {
            throw new CustomError(ErrorObject.PrivateKeyInvalidErr, "Private key is empty");
        }

        await keyWallet.KeySet.importFromPrivateKey(keyWallet.KeySet.PrivateKey);

        let account = new AccountWallet(this);
        account.key = keyWallet;
        account.child = [];
        account.isImport = true;
        account.name = accountName;

        return account;
    }

    async createAccountWithId(accountId, accountName) {
        const childKey = await NewKey(this.Seed, accountId, 0);
        const accountWallet = new AccountWallet(this);
        accountWallet.key = childKey;
        accountWallet.child = [];
        accountWallet.name = accountName;

        return accountWallet;
    }

    exportAccountPrivateKey(childIndex) {
        return this.MasterAccount.child[childIndex].key.base58CheckSerialize(PriKeyType);
    }

    exportAccountReadonlyKey(childIndex) {
        return this.MasterAccount.child[childIndex].key.base58CheckSerialize(ReadonlyKeyType);
    }

    validateAccountName(name) {
        if (!name) {
            throw new CustomError(ErrorObject.InvalidAccountName, "Account name is invalid");
        }

        for (let i = 0; i < this.MasterAccount.child.length; i++) {
            let account = this.MasterAccount.child[i];

            if (account.name === name) {
                throw new CustomError(ErrorObject.ExistedAccountErr, "Name of importing account was existed");
            }
        }
    }

    validatePrivateKey(privateKey) {
        for (let i = 0; i < this.MasterAccount.child.length; i++) {
            let account = this.MasterAccount.child[i];

            if (account.key.base58CheckSerialize(PriKeyType) == privateKey) {
                throw new CustomError(ErrorObject.ExistedAccountErr, "Private key of importing account was existed");
            }
        }
    }

    removeAccount(accPrivateKeyStr, passPhrase) {
        for (let i = 0; i < this.MasterAccount.child.length; i++) {
            let account = this.MasterAccount.child[i];
            if (account.key.base58CheckSerialize(PriKeyType) === accPrivateKeyStr) {
                this.MasterAccount.child.splice(i, 1);
                this.save(passPhrase);
                return;
            }
        }
        throw new CustomError(ErrorObject.UnexpectedErr, "Account need to be removed is not existed");
    }

    async importAccount(privakeyStr, accountName, passPhrase) {
        for (let i = 0; i < this.MasterAccount.child.length; i++) {
            let account = this.MasterAccount.child[i];

            if (account.key.base58CheckSerialize(PriKeyType) === privakeyStr) {
                throw new CustomError(ErrorObject.ExistedAccountErr, "Private key of importing account was existed");
            }

            if (account.name === accountName) {
                throw new CustomError(ErrorObject.ExistedAccountErr, "Name of importing account was existed");
            }
        }

        const account = await this.createAccountWithPrivateKey(privakeyStr, accountName);

        this.MasterAccount.child.push(account);
        this.save(this.PassPhrase || passPhrase);
        return account
    }

    async importAccountWithId(accountId, accountName, index = 0) {
        try {
            this.validateAccountName(accountName);
        } catch {
            this.importAccountWithId(accountId, accountName + index, index + 1);
        }

        const account = await this.createAccountWithId(accountId, accountName);

        this.validatePrivateKey(account.key.base58CheckSerialize(PriKeyType));

        this.MasterAccount.child.push(account);
        this.save(this.PassPhrase);

        return account;
    }

    save(password = '') {
        if (password === '') {
            password = this.PassPhrase
        }

        // parse to byte[]
        for (let i = 0; i < this.MasterAccount.child.length; i++) {
            this.MasterAccount.child[i].key.ChainCode = Array.from(this.MasterAccount.child[i].key.ChainCode);
            this.MasterAccount.child[i].key.ChildNumber = Array.from(this.MasterAccount.child[i].key.ChildNumber);
            this.MasterAccount.child[i].key.KeySet.PrivateKey = Array.from(this.MasterAccount.child[i].key.KeySet.PrivateKey);
            this.MasterAccount.child[i].key.KeySet.PaymentAddress.Pk = Array.from(this.MasterAccount.child[i].key.KeySet.PaymentAddress.Pk)
            this.MasterAccount.child[i].key.KeySet.PaymentAddress.Tk = Array.from(this.MasterAccount.child[i].key.KeySet.PaymentAddress.Tk)
            this.MasterAccount.child[i].key.KeySet.ReadonlyKey.Pk = Array.from(this.MasterAccount.child[i].key.KeySet.ReadonlyKey.Pk)
            this.MasterAccount.child[i].key.KeySet.ReadonlyKey.Rk = Array.from(this.MasterAccount.child[i].key.KeySet.ReadonlyKey.Rk)
        }

        this.MasterAccount.key.ChainCode = Array.from(this.MasterAccount.key.ChainCode);
        this.MasterAccount.key.ChildNumber = Array.from(this.MasterAccount.key.ChildNumber);
        this.MasterAccount.key.KeySet.PrivateKey = Array.from(this.MasterAccount.key.KeySet.PrivateKey);
        this.MasterAccount.key.KeySet.PaymentAddress.Pk = Array.from(this.MasterAccount.key.KeySet.PaymentAddress.Pk);
        this.MasterAccount.key.KeySet.PaymentAddress.Tk = Array.from(this.MasterAccount.key.KeySet.PaymentAddress.Tk);
        this.MasterAccount.key.KeySet.ReadonlyKey.Pk = Array.from(this.MasterAccount.key.KeySet.ReadonlyKey.Pk);
        this.MasterAccount.key.KeySet.ReadonlyKey.Rk = Array.from(this.MasterAccount.key.KeySet.ReadonlyKey.Rk);

        // remove cached of master account and its childs from wallet before saving wallet
        let masterDerivatorToSerialNumberCache = this.MasterAccount.derivatorToSerialNumberCache;
        this.MasterAccount.derivatorToSerialNumberCache = {};

        let masterSpentCoinCached = this.MasterAccount.spentCoinCached;
        this.MasterAccount.spentCoinCached = {};

        let childDerivatorToSerialNumberCaches = new Array(this.MasterAccount.child.length);
        let childSpentCoinCacheds = new Array(this.MasterAccount.child.length);

        for (let i = 0; i < this.MasterAccount.child.length; i++) {

            childDerivatorToSerialNumberCaches[i] = this.MasterAccount.child[i].derivatorToSerialNumberCache;
            childSpentCoinCacheds[i] = this.MasterAccount.child[i].spentCoinCached;

            this.MasterAccount.child[i].derivatorToSerialNumberCache = {};
            this.MasterAccount.child[i].spentCoinCached = {};
        }

        let data = JSON.stringify(this);

        this.MasterAccount.derivatorToSerialNumberCache = masterDerivatorToSerialNumberCache;
        this.MasterAccount.spentCoinCached = masterSpentCoinCached;
        for (let i = 0; i < childDerivatorToSerialNumberCaches.length; i++) {
            this.MasterAccount.child[i].derivatorToSerialNumberCache = childDerivatorToSerialNumberCaches[i];
            this.MasterAccount.child[i].spentCoinCached = childSpentCoinCacheds[i];
        }

        // encrypt
        let cipherText = CryptoJS.AES.encrypt(data, password);

        // storage
        if (this.Storage != null) {
            return this.Storage.setItem(this.Name, cipherText.toString());
        }
    }

    clearCached(storage) {
        this.MasterAccount.clearCached(storage);
        for (let i = 0; i < this.MasterAccount.child.length; i++) {
            this.MasterAccount.child[i].clearCached(storage, `${this.Name}-${this.MasterAccount.child[i].name}-cached`);
        }
        this.save('');
    }

    async getHistoryByAccount(accName) {
        let account = this.getAccountByName(accName);
        return account.getNormalTxHistory();
    }

    async loadWallet(password) {
        if (this.Storage != null) {
            let cipherText = await this.Storage.getItem(this.Name);
            if (!cipherText) return false;
            let data = CryptoJS.AES.decrypt(cipherText, password);
            let jsonStr = data.toString(CryptoJS.enc.Utf8);

            try {
                let obj = JSON.parse(jsonStr);
                Object.setPrototypeOf(obj, Wallet.prototype);
                Object.setPrototypeOf(obj.MasterAccount, AccountWallet.prototype);
                Object.setPrototypeOf(obj.MasterAccount.key, KeyWallet.prototype);

                obj.Seed = Buffer.from(obj.Seed);

                Object.assign(this, obj);

                for (let i = 0; i < obj.MasterAccount.child.length; i++) {
                    Object.setPrototypeOf(obj.MasterAccount.child[i], AccountWallet.prototype);
                    Object.setPrototypeOf(obj.MasterAccount.child[i].key, KeyWallet.prototype);

                    // chaincode
                    Object.setPrototypeOf(obj.MasterAccount.child[i].key.ChainCode, Array.prototype);
                    obj.MasterAccount.child[i].key.ChainCode = new Uint8Array(obj.MasterAccount.child[i].key.ChainCode);

                    // child num
                    Object.setPrototypeOf(obj.MasterAccount.child[i].key.ChildNumber, Array.prototype);
                    obj.MasterAccount.child[i].key.ChildNumber = new Uint8Array(obj.MasterAccount.child[i].key.ChildNumber)

                    Object.setPrototypeOf(obj.MasterAccount.child[i].key.KeySet, KeySet.prototype);

                    // payment address
                    Object.setPrototypeOf(obj.MasterAccount.child[i].key.KeySet.PaymentAddress, PaymentAddress.prototype);
                    Object.setPrototypeOf(obj.MasterAccount.child[i].key.KeySet.PaymentAddress.Pk, Array.prototype);
                    obj.MasterAccount.child[i].key.KeySet.PaymentAddress.Pk = new Uint8Array(obj.MasterAccount.child[i].key.KeySet.PaymentAddress.Pk);
                    Object.setPrototypeOf(obj.MasterAccount.child[i].key.KeySet.PaymentAddress.Tk, Array.prototype);
                    obj.MasterAccount.child[i].key.KeySet.PaymentAddress.Tk = new Uint8Array(obj.MasterAccount.child[i].key.KeySet.PaymentAddress.Tk);
                    Object.setPrototypeOf(obj.MasterAccount.child[i].key.KeySet.PaymentAddress.OTAPublic, Array.prototype);
                    obj.MasterAccount.child[i].key.KeySet.PaymentAddress.OTAPublic = new Uint8Array(obj.MasterAccount.child[i].key.KeySet.PaymentAddress.OTAPublic);

                    // read only key
                    Object.setPrototypeOf(obj.MasterAccount.child[i].key.KeySet.ReadonlyKey, ViewingKey.prototype);
                    Object.setPrototypeOf(obj.MasterAccount.child[i].key.KeySet.ReadonlyKey.Pk, Array.prototype);
                    obj.MasterAccount.child[i].key.KeySet.ReadonlyKey.Pk = new Uint8Array(obj.MasterAccount.child[i].key.KeySet.ReadonlyKey.Pk);
                    Object.setPrototypeOf(obj.MasterAccount.child[i].key.KeySet.ReadonlyKey.Rk, Array.prototype);
                    obj.MasterAccount.child[i].key.KeySet.ReadonlyKey.Rk = new Uint8Array(obj.MasterAccount.child[i].key.KeySet.ReadonlyKey.Rk);

                    Object.setPrototypeOf(obj.MasterAccount.child[i].key.KeySet.OTAKey, OTAKey.prototype);
                    Object.setPrototypeOf(obj.MasterAccount.child[i].key.KeySet.OTAKey.Pk, Array.prototype);
                    obj.MasterAccount.child[i].key.KeySet.OTAKey.Pk = new Uint8Array(obj.MasterAccount.child[i].key.KeySet.OTAKey.Pk);
                    Object.setPrototypeOf(obj.MasterAccount.child[i].key.KeySet.ReadonlyKey.OTASecret, Array.prototype);
                    obj.MasterAccount.child[i].key.KeySet.OTAKey.OTASecret = new Uint8Array(obj.MasterAccount.child[i].key.KeySet.OTAKey.OTASecret);

                    // private key
                    Object.setPrototypeOf(obj.MasterAccount.child[i].key.KeySet.PrivateKey, Array.prototype);
                    obj.MasterAccount.child[i].key.KeySet.PrivateKey = new Uint8Array(obj.MasterAccount.child[i].key.KeySet.PrivateKey);
                }

                Object.assign(this, obj);
            } catch (e) {
                throw new CustomError(ErrorObject.LoadWalletErr, e.message || "Error when load wallet");
            }
        }
    }

    async loadAccountsCached(accName = null) {
        if (accName) {
            let account = this.getAccountByName(accName);
            return await account.loadAccountCached(this.Storage);
        }

        await this.MasterAccount.loadAccountCached(this.Storage);
        for (let i = 0; i < this.MasterAccount.child.length; i++) {
            await this.MasterAccount.child[i].loadAccountCached(this.Storage);
        }
    }

    async listAccount() {
        const accounts = [];

        for (let index = 0; index < this.MasterAccount.child.length; index++) {
            const account = this.MasterAccount.child[index];
            const info = await account.getDeserializeInformation();

            accounts.push({
                ...info,
                "Index": index,
            });
        }

        return accounts;
    }

    async listAccountWithBLSPubKey() {
        let accounts = [];

        for (let i = 0; i < this.MasterAccount.child.length; i++) {
            let child = this.MasterAccount.child[i];
            let miningSeedKey = hashSha3BytesToBytes(hashSha3BytesToBytes(child.key.KeySet.PrivateKey));
            let blsPublicKey = await generateBLSPubKeyB58CheckEncodeFromSeed(miningSeedKey);

            accounts[i] = {
                "AccountName": child.name,
                "BLSPublicKey": blsPublicKey,
                "Index": i,
            }
        }

        return accounts;
    }

    async updateStatusHistory() {
        for (let i = 0; i < this.MasterAccount.child.length; i++) {
            await this.MasterAccount.child[i].updateAllTransactionsStatus();
        }
    }

    async updateTxStatus(txId) {
        let tx;
        let account;
        for (account of this.MasterAccount.child) {
            const nativeTx = account.txHistory.NormalTx.find(item => item.txID === txId);
            const coinTx = account.txHistory.PrivacyTokenTx.find(item => item.txID === txId);

            tx = nativeTx || coinTx;

            if (tx) {
                break;
            }
        }

        if (!tx || !account) {
            return;
        }

        let response;
        try {
            response = await Wallet.RpcClient.getTransactionByHash(txId);
        } catch (e) {
            throw new CustomError(ErrorObject.GetTxByHashErr, e.message);
        }

        if (response.isInBlock) {
            tx.status = ConfirmedTx;

            if (tx.isPrivacyNativeToken) {
                account.removeObjectFromSpendingCoins(txId);
            }
        } else if (!response.isInBlock && !response.isInMempool && response.err !== null) {
            tx.status = FailedTx;

            if (tx.isPrivacyNativeToken) {
                account.removeObjectFromSpendingCoins(txId);
            }
        }
    }

    deleteWallet() {
        try {
            if (typeof this.Storage.removeItem === 'function') {
                this.Storage.removeItem("Wallet");
            }
        } catch (e) {
            throw new CustomError(ErrorObject.DeleteWalletErr, e.message || "Can not remove item in storage");
        }
    }

    static RpcClient;

    setProvider(url, user, password) {
        this.rpc = new RpcClient(url, user, password);
    }

    static setPrivacy = async (wasmFile = './privacy.wasm') => {
    	await load(wasmFile);
    };

    static RandomBytesFunc = null;

    static setPrivacyUtilRandomBytesFunc(randomBytesFunc) {
        setRandBytesFunc(randomBytesFunc);
    }

    static ProgressTx = 0;

    static sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    static async updateProgressTx(progress) {
        Wallet.ProgressTx = progress;
        await Wallet.sleep(100);
    }

    static async resetProgressTx() {
        await Wallet.updateProgressTx(0);
    }

    static ShardNumber = 8;

    static Debug = '';
}

class DefaultStorage {
    constructor() {
        this.Data = {}
    }

    async setItem(key, value) {
        this.Data[key] = value;
        return Promise.resolve()
    }

    async getItem(key) {
        return this.Data[key];
    }
}

export {
    Wallet,
    DefaultStorage,
    TxHistoryInfo,
    PaymentInfo,
    KeyWallet,
    PaymentAddressType,
    CustomTokenTransfer,
    CustomTokenInit,
    PRVIDSTR,
    ENCODE_VERSION,
    FailedTx,
    SuccessTx,
    ConfirmedTx,
    MetaStakingBeacon,
    MetaStakingShard,
    checkEncode,
    toNanoPRV,
    toPRV,
    getShardIDFromLastByte,
    generateECDSAKeyPair,
    generateBLSKeyPair,
    RPCHttpService,
    RpcClient,
    BurningRequestMeta,
    WithDrawRewardRequestMeta,
    PDEContributionMeta,
    PDEPRVRequiredContributionRequestMeta,
    PDETradeRequestMeta,
    PDECrossPoolTradeRequestMeta,
    PDEWithdrawalRequestMeta,
    hybridEncryption,
    hybridDecryption,
    encryptMessageOutCoin, decryptMessageOutCoin,
    constants,
    newMnemonic,
    newSeed,
    validateMnemonic,
}
