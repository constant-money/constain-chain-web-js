import bn from 'bn.js';
import _ from 'lodash';
import {
    CustomTokenInit,
    TxNormalType,
    TxCustomTokenPrivacyType,
    CustomTokenTransfer,
    MaxInputNumberForDefragment,
    MAX_INPUT_PER_TX, MAX_DEFRAGMENT_TXS,
} from './tx/constants';
// import {
//     KeyWallet
// } from "./hdwallet";
import {
    FailedTx,
    SuccessTx,
    MetaStakingBeacon,
    MetaStakingShard,
    PaymentAddressType,
    ReadonlyKeyType,
    PriKeyType,
    OTAKeyType,
    PDETradeRequestMeta,
    PDECrossPoolTradeRequestMeta,
    PDEWithdrawalRequestMeta,
    StopAutoStakingMeta,
    ShardStakingType,
    BurningRequestMeta,
    WithDrawRewardRequestMeta,
    PRVID,
    PRVIDSTR,
    PercentFeeToReplaceTx,
    encryptMessageOutCoin,
    decryptMessageOutCoin,
    getBurningAddress,
    TxHistoryInfo,
    KeyWallet,
    base58CheckDeserialize,
    PDEPRVRequiredContributionRequestMeta,

} from "./core";
import {
    checkEncode,
    checkDecode
} from "./common/base58";
import {
    // prepareInputForTx,
    prepareInputForTxV2,
    // prepareInputForTxPrivacyToken,
    getUnspentCoin,
    // newParamInitTx,
    // newParamInitPrivacyTokenTx,
    newParamTxV2,
    newTokenParamV2,
    prepareInputForDefragments,
    newParamInitTx,
    // prepareInputForReplaceTxNormal,
    // prepareInputForReplaceTxPrivacyToken,
    // prepareInputForDefragments,
} from "./tx/utils";
import {
    ENCODE_VERSION,
    ED25519_KEY_SIZE, ShardNumber
} from "./common/constants";
import {
    convertHashToStr
} from "./common/common";
import {
    generateCommitteeKeyFromHashPrivateKey
} from "./common/committeekey";
import {
    hashSha3BytesToBytes,
    base64Decode,
    base64Encode,
    stringToBytes,
    bytesToString,
    setRandBytesFunc
} from "./privacy/utils";
import {
    CustomError,
    ErrorObject
} from './common/errorhandler';
import {addressToUnmarshallable} from './common/keySet';
import {
    RpcClient
} from"./rpcclient/rpcclient";
import {wasm, load} from './wasm/loader';
import { Wallet } from './wallet';

class Transactor {
    constructor(w) {
        this.wallet = w;
        this.rpc = new RpcClient(w.rpc.rpcHttpService.url);
        this.name = "";
        this.key = new KeyWallet();
        this.child = [];
        this.isImport = false;
        this.followingTokens = [];
        this.txHistory = {
            NormalTx: [],
            CustomTokenTx: [],
            PrivacyTokenTx: []
        };
        this.txReceivedHistory = {
            NormalTx: [],
            CustomTokenTx: [],
            PrivacyTokenTx: []
        };

        // derivatorPointCached is used for saving derivator (encoded) with corresponding encoded serial number in bytes array that was calculated before
        this.derivatorToSerialNumberCache = {}
        // spentCoinCached is used for cache spent coin
        this.spentCoinCached = {}
        // list of serial number of coins in tx in mempool
        this.spendingCoins = [];

        // isRevealViewKeyToGetCoins is true: reveal private viewing key when request for getting all output coins
        this.isRevealViewKeyToGetCoins = false;

        this.isSubmitOtaKey = false;
        this.offlineMode = false;

        // function aliases
        this.make = this.doPRVTransactionV2;
        this.prv = this.createAndSendNativeToken;
        this.token = this.createAndSendPrivacyToken;
        this.mintToken = async (tokenPaymentInfo, fee, tokenParams) => this.token("", [], tokenPaymentInfo, fee, "", false, false, tokenParams);
        this.stake = this.createAndSendStakingTx;
        this.unstake = this.createAndSendStopAutoStakingTx;
        this.withdraw = this.createAndSendWithdrawRewardTx;
        this.convert = this.createAndSendConvertTx;
        this.convertToken = this.createAndSendTokenConvertTx;
        this.contribute = this.createAndSendTxWithContribution;
        this.trade = this.createAndSendNativeTokenTradeRequestTx;
        this.withdrawDex = this.createAndSendWithdrawDexTx;
        this.burn = this.createAndSendBurningRequestTx;
        this.defrag = this.defragmentNativeCoinAll;
        this.coin = this.getUnspentToken;
        this.balance = this.getBalance;
        this.waitBalanceChange = this.waitUntilBalanceChange;
    };

    async setKey(privateKey){
        // transactor needs private key to sign TXs
        this.key = base58CheckDeserialize(privateKey);
        let result = await this.key.KeySet.importFromPrivateKey(this.key.KeySet.PrivateKey);
        return result;
    };

    /**
     * setIsRevealViewKeyToGetCoins updates isRevealViewKeyToGetCoins of AccountWallet
     * @param {bool} isRevealViewKeyToGetCoins
    */
    setIsRevealViewKeyToGetCoins(isRevealViewKeyToGetCoins) {
        this.isRevealViewKeyToGetCoins = isRevealViewKeyToGetCoins;
    }

    // addSpendingCoins adds spending coin object to spending coins list
    /**
     * @param {txID: string, spendingSNs: array} spendingCoinObj
     */
    addSpendingCoins(spendingCoinObj) {
        if (!this.spendingCoins) {
            this.spendingCoins = [];
        }

        this.spendingCoins.push(spendingCoinObj);
    }

    // removeObjectFromSpendingCoins removes spending coins in txId from list of spending coins
    /**
     *
     * @param {string} txId
     */
    removeObjectFromSpendingCoins(txId) {
        for (let i = 0; i < this.spendingCoins.length; i++) {
            if (this.spendingCoins[i].txID === txId) {
                this.spendingCoins.splice(i, 1);
                break;
            }
        }
    }

    // clearCached clears all caches
    clearCached(storage, key) {
        this.derivatorToSerialNumberCache = {};
        this.spentCoinCached = {};

        if (storage !== null && storage.removeItem) {
            return storage.removeItem(key || `${this.name}-cached`);
        }
    }

    // saveAccountCached saves derivatorToSerialNumberCache and spentCoinCached for account
    /**
     *
     * @param {object} storage
     */
    saveAccountCached(storage, key) {
        const cacheObject = {
            derivatorToSerialNumberCache: this.derivatorToSerialNumberCache,
            spentCoinCached: this.spentCoinCached
        };

        const data = JSON.stringify(cacheObject);

        // storage
        if (storage != null) {
            return storage.setItem(key || `${this.name}-cached`, data);
        }
    }

    // loadAccountCached loads cache that includes derivatorToSerialNumberCache, inputCoinJsonCached and spentCoinCached for account
    /**
     *
     * @param {string} password
     * @param {object} storage
     */
    async loadAccountCached(storage, key) {
        if (storage != null) {
            const text = await storage.getItem(key || `${this.name}-cached`);
            if (!text) return false;
            const data = JSON.parse(text);
            this.derivatorToSerialNumberCache = data.derivatorToSerialNumberCache;
            this.spentCoinCached = data.spentCoinCached;
        }
    }

    // analyzeOutputCoinFromCached devides allOutputCoinStrs into list of cached output coins and list of uncached output coins
    /**
     *
     * @param {[Coin]} allOutputCoinStrs
     * @param {string} tokenID
     */
    analyzeOutputCoinFromCached(allOutputCoinStrs, tokenID) {
        if (!tokenID) {
            tokenID = PRVIDSTR;
        }
        this.derivatorToSerialNumberCache = this.derivatorToSerialNumberCache === undefined ? {} : this.derivatorToSerialNumberCache;
        let uncachedOutputCoinStrs = [];
        let cachedOutputCoinStrs = [];

        for (let i = 0; i < allOutputCoinStrs.length; i++) {
            const sndStr = `${tokenID}_${allOutputCoinStrs[i].KeyImage}`;

            if (this.derivatorToSerialNumberCache[sndStr] !== undefined) {
                allOutputCoinStrs[i].SerialNumber = this.derivatorToSerialNumberCache[sndStr];
                cachedOutputCoinStrs.push(allOutputCoinStrs[i]);
            } else {
                uncachedOutputCoinStrs.push(allOutputCoinStrs[i]);
            }
        }
        return {
            uncachedOutputCoinStrs: uncachedOutputCoinStrs,
            cachedOutputCoinStrs: cachedOutputCoinStrs,
        }
    }

    // mergeSpentCoinCached caches spent input coins to spentCoinCached
    /**
     *
     * @param {[Coin]} unspentCoinStrs
     * @param {[Coin]} unspentCoinStrsFromCache
     * @param {string} tokenID
     */
    async mergeSpentCoinCached(unspentCoinStrs, unspentCoinStrsFromCache, tokenID) {
        if (!tokenID) {
            tokenID = PRVIDSTR;
        }
        this.spentCoinCached = this.spentCoinCached === undefined ? {} : this.spentCoinCached;
        let chkAll = {};
        for (let i = 0; i < unspentCoinStrsFromCache.length; i++) {
            const sndStr = `${tokenID}_${unspentCoinStrsFromCache[i].SNDerivator}`;
            chkAll[sndStr] = true;
        }
        for (let i = 0; i < unspentCoinStrs.length; i++) {
            const sndStr = `${tokenID}_${unspentCoinStrs[i].SNDerivator}`;
            chkAll[sndStr] = false;
        }
        for (let sndStr in chkAll) {
            if (sndStr != undefined && chkAll[sndStr] === true) {
                this.spentCoinCached[sndStr] = true;
            }
        }
    }

    // analyzeSpentCoinFromCached returns input coins which it not existed in list of cached spent input coins
    /**
     *
     * @param {[Coin]} inCoinStrs
     * @param {string} tokenID
     */
    analyzeSpentCoinFromCached(inCoinStrs, tokenID) {
        if (!tokenID) {
            tokenID = PRVIDSTR;
        }
        this.spentCoinCached = this.spentCoinCached === undefined ? {} : this.spentCoinCached;
        let unspentInputCoinsFromCachedStrs = [];

        for (let i = 0; i < inCoinStrs.length; i++) {
            const sndStr = `${tokenID}_${inCoinStrs[i].SNDerivator}`;
            if (this.spentCoinCached[sndStr] === undefined) {
                unspentInputCoinsFromCachedStrs.push(inCoinStrs[i]);
            }
        }

        return {
            unspentInputCoinsFromCachedStrs: unspentInputCoinsFromCachedStrs,
        };
    }

    // deriveSerialNumbers returns list of serial numbers of input coins
    /**
     *
     * @param {string} spendingKeyStr
     * @param {[Coin]} inCoinStrs
     * @param {string} tokenID
     */
    async deriveSerialNumbers(spendingKeyStr, inCoinStrs, tokenID = null) {
        if (!tokenID) {
            tokenID = PRVIDSTR;
        }

        let serialNumberStrs = new Array(inCoinStrs.length);
        let serialNumberBytes = new Array(inCoinStrs.length);
        let snds = new Array(inCoinStrs.length);

        // calculate serial number (Call WASM/gomobile function)
        for (let i = 0; i < inCoinStrs.length; i++) {
            snds[i] = inCoinStrs[i].SNDerivator;
        }



        let param = {
            "privateKey": spendingKeyStr,
            "snds": snds
        };

        let paramJson = JSON.stringify(param);

        let res = await wasmFuncs.deriveSerialNumber(paramJson);
        if (res === null || res === "") {
            throw new Error("Can not derive serial number");
        }

        let tmpBytes = base64Decode(res);
        for (let i = 0; i < snds.length; i++) {
            serialNumberBytes[i] = tmpBytes.slice(i * ED25519_KEY_SIZE, (i + 1) * ED25519_KEY_SIZE);
            serialNumberStrs[i] = checkEncode(serialNumberBytes[i], ENCODE_VERSION);
            inCoinStrs[i].SerialNumber = serialNumberStrs[i];

            // cache snd and corressponding serial number
            const sndStr = `${tokenID}_${snds[i]}`;
            this.derivatorToSerialNumberCache[sndStr] = serialNumberStrs[i];
        }

        return {
            serialNumberStrs: serialNumberStrs,
            inCoinStrs: inCoinStrs
        };
    }

    // listFollowingTokens returns list of following tokens
    listFollowingTokens() {
        return this.followingTokens;
    };

    // addFollowingToken adds token data array to following token list
    /**
     * @param {...{ID: string, Image: string, Name: string, Symbol: string, Amount: number, IsPrivacy: boolean, isInit: boolean, metaData: object}} tokenData - tokens to follow
     */
    addFollowingToken(...tokenData) {
        if (tokenData.constructor === Array) {
            const addedTokenIds = this.followingTokens.map(t => t.ID);
            const tokenDataSet = {};
            tokenData.forEach(t => {
                if (!addedTokenIds.includes(t.ID)) {
                    tokenDataSet[t.ID] = t;
                }
            });

            const tokens = Object.values(tokenDataSet);
            this.followingTokens.unshift(...tokens);
        }
    };

    // removeFollowingToken removes token which has tokenId from list of following tokens
    /**
     *
     * @param {string} tokenId
     */
    removeFollowingToken(tokenId) {
        const removedIndex = this.followingTokens.findIndex(token => token.ID === tokenId);
        if (removedIndex !== -1) {
            this.followingTokens.splice(removedIndex, 1);
        }
    }

    // saveNormalTxHistory save history of normal tx to history account
    /**
     * @param {{txId: string, typeTx: string, amountNativeToken: number, feeNativeToken: number, txStatus: number, lockTime: number}} tx
     *  @param {[string]} receivers
     * @param {bool} isIn
     * @param {bool} isPrivacy
     * @param {[string]} listUTXOForPRV
     * @param {string} hashOriginalTx
     */
    // saveNormalTxHistory(response, tx, amount, inputs, receivers, isIn, isPrivacyNativeToken,
    //     hashOriginalTx = "", metaData = null, info = "", messageForNativeToken = "")
    saveNormalTxHistory(txResult, isIn, hashOriginalTx = "", messageForNativeToken = "") {
        if (txResult.Response.offline) return;
        let txHistory = new TxHistoryInfo();
        let response = txResult.Response;
        // check status of tx and add coins to spending coins
        let listUTXOForPRV = [];
        let listUTXOForPToken = [];
        let status = FailedTx;
        if (txResult.Response.txId) {
            status = SuccessTx;
            // add spending list
            let spendingSNs = [];
            for (let i = 0; i < txResult.Inputs.length; i++) {
                spendingSNs.push(txResult.Inputs[i].KeyImage);
                listUTXOForPRV.push(txResult.Inputs[i].PublicKey);
            }
            this.addSpendingCoins({
                txID: txResult.Response.txId,
                spendingSNs: spendingSNs
            });
            spendingSNs = [];
            if (txResult.TokenInputs){
                for (let i = 0; i < txResult.TokenInputs.length; i++) {
                    spendingSNs.push(txResult.TokenInputs[i].KeyImage);
                    listUTXOForPToken.push(txResult.TokenInputs[i].PublicKey);
                }
                this.addSpendingCoins({
                    txID: txResult.Response.txId,
                    spendingSNs: spendingSNs
                });
            }
        }

        let historyObj = {
            txID: txResult.Response.txId,
            amountNativeToken: txResult.Amount, // in nano PRV
            amountPToken: txResult.TokenAmount,
            feeNativeToken: txResult.Tx.Fee, // in nano PRV
            feePToken: 0, // in nano PRV
            typeTx: txResult.Tx.Type,
            receivers: txResult.Receivers,
            tokenName: "",
            tokenID: txResult.TokenID,
            tokenSymbol: "",
            isIn: isIn,
            time: txResult.Tx.LockTime * 1000, // in mili-second
            status: status,
            isPrivacyNativeToken: txResult.IsPrivacy,
            isPrivacyForPToken: true,
            listUTXOForPRV: listUTXOForPRV,
            listUTXOForPToken: listUTXOForPToken,
            hashOriginalTx: hashOriginalTx,
            metaData: txResult.Metadata,
            info: txResult.Info,
            messageForNativeToken: messageForNativeToken,
            messageForPToken: ""
        }

        txHistory.setHistoryInfo(historyObj);
        let isPRV = (txResult.Tx.Type=="n") || (txResult.TokenInputs);
        if (isPRV){
            this.txHistory.NormalTx.unshift(txHistory);
        }else{
            this.txHistory.PrivacyTokenTx.unshift(txHistory);
        }
    };

    // getNormalTxHistory return history of normal txs
    getNormalTxHistory() {
        return this.txHistory.NormalTx;
    };

    // getPrivacyTokenTxHistory return history of normal txs
    getPrivacyTokenTxHistory() {
        return this.txHistory.PrivacyTokenTx;
    };

    getCustomTokenTx() {
        return this.txHistory.CustomTokenTx;
    };

    // getTxHistoryByTxID returns tx history for specific tx id
    /**
     *
     * @param {string} txID
     */
    getTxHistoryByTxID(txID) {
        return this.txHistory.NormalTx.find(item => item.txID === txID) ||
          this.txHistory.PrivacyTokenTx.find(item => item.txID === txID) ||
          this.txHistory.CustomTokenTx.find(item => item.txID === txID)
    }

    // getPrivacyTokenTxHistoryByTokenID returns privacy token tx history with specific tokenID
    /**
     *
     * @param {string} id
     */
    getPrivacyTokenTxHistoryByTokenID(id) {
        let queryResult = new Array();
        for (let i = 0; i < this.txHistory.PrivacyTokenTx.length; i++) {
            if (this.txHistory.PrivacyTokenTx[i].tokenID === id)
                queryResult.push(this.txHistory.PrivacyTokenTx[i]);
        }
        return queryResult;
    }

    getCustomTokenTxByTokenID(id) {
        let queryResult = new Array();
        for (let i = 0; i < this.txHistory.CustomTokenTx.length; i++) {
            if (this.txHistory.CustomTokenTx[i].tokenID === id)
                queryResult.push(this.txHistory.CustomTokenTx[i]);
        }
        return queryResult;
    }

    // getAllOutputCoins returns all output coins with tokenID
    // for native token: tokenId is null
    /**
     *
     * @param {string} tokenID
     * @param {RpcClient} rpcClient
     */
    async fetchOutputCoins(tokenID, rpcClient, version = "2") {
        let paymentAddrSerialize = this.key.base58CheckSerialize(PaymentAddressType);
        let readOnlyKeySerialize = this.key.base58CheckSerialize(ReadonlyKeyType);
        let otaKeySerialize = this.key.base58CheckSerialize(OTAKeyType);
        let privKeySerialize = this.key.base58CheckSerialize(PriKeyType);
        const handler = async (response, sk, ver, reveal, result) => {
            // when key was submitted, only send 1 rpc request
            if (reveal) response.next = 0;

            let coins = response.outCoins;
            for (let i = 0; i < coins.length; i++) {
                // match the desired version. Version -1 means any
                if (ver==-1 || coins[i].Version==ver){
                    let params = {
                        Coin: coins[i],
                        KeySet: sk
                    }
                    try{
                        let coinStr = await wasm.decryptCoin(JSON.stringify(params));
                        let coin = JSON.parse(coinStr);
                        // console.log("decrypt coin", coin);
                        // console.log("from", params.Coin);
                        if (coins[i].Version==2 || response.next==0) result.push(coin);
                    }catch(e){
                        console.error(e);
                        console.log("skip coin", params.Coin.PublicKey);
                    }
                }
            }
            // finished
            return response.next;
        }

        let req = async (paymentAddr, roKey, otaKey, tid, toHeight = 0) => {
            try {
                let res = await this.rpc.getOutputCoin(paymentAddr, roKey, otaKey, tid, toHeight, this.isSubmitOtaKey);
                return res;
            } catch (e) {
                throw new CustomError(ErrorObject.GetOutputCoinsErr, e.message || "Can not get output coins when get unspent token");
            }
        }

        let result = [];
        let h = 0;
        // this client config searches up to 9yrs
        for (let i = 0; i < 3000; i++) {
            try{
                let response = await req(paymentAddrSerialize, readOnlyKeySerialize, otaKeySerialize, tokenID, h);
                h = await handler(response, privKeySerialize, version, this.isSubmitOtaKey, result);
                if (h==0) break;
            }catch(e){
                console.error(e);
                return [];
            }
        }
        return result;
    }

    // getUnspentToken returns unspent output coins with tokenID
    // for native token: tokenId is null
    /**
     *
     * @param {string} tokenID
     * @param {RpcClient} rpcClient
     */
    async getUnspentToken(tokenID, version = "2") {
        let paymentAddrSerialize = this.key.base58CheckSerialize(PaymentAddressType);
        // get all output coins of spendingKey
        let allOutputCoinStrs;
        try {
            allOutputCoinStrs = await this.fetchOutputCoins(tokenID, this.rpc, version);
        } catch (e) {
            throw new CustomError(ErrorObject.GetOutputCoinsErr, e.message || "Can not get output coins when get unspent token");
        }

        // console.debug("outputs from rpc", allOutputCoinStrs);
        // devide all of output coins into uncached and cached out put coins list
        let { uncachedOutputCoinStrs, cachedOutputCoinStrs } = this.analyzeOutputCoinFromCached(allOutputCoinStrs, tokenID);

        // get unspent output coin from cache
        let { unspentInputCoinsFromCachedStrs } = this.analyzeSpentCoinFromCached(allOutputCoinStrs, tokenID);
        // check whether unspent coin from cache is spent or not
        let { unspentCoinStrs } = await getUnspentCoin(paymentAddrSerialize, unspentInputCoinsFromCachedStrs, tokenID, this.rpc);
        // cache spent output coins
        this.mergeSpentCoinCached(unspentCoinStrs, unspentInputCoinsFromCachedStrs, tokenID);
        // console.debug("outputs from filtered", unspentCoinStrs);

        if (!this.coinUTXOs) {
            this.coinUTXOs = {};
        }
        this.coinUTXOs[tokenID || PRVIDSTR] = unspentCoinStrs.length;

        return unspentCoinStrs;
    }

    // getBalance returns balance for token (native token or privacy token)
    // tokenID default is null: for PRV
    /**
     *
     * @param {string} tokenID
     */
    async getBalance(tokenID) {
        tokenID = tokenID ? tokenID : PRVIDSTR;
        // get coins of all versions
        let unspentCoinStrs = await this.getUnspentToken(tokenID, -1);

        // total
        let accountBalance = 0;
        for (let i = 0; i < unspentCoinStrs.length; i++) {
            accountBalance += parseInt(unspentCoinStrs[i].Value)
        }

        return accountBalance
    }

    async waitUntilBalanceChange(tokenID){
        // console.debug(this.key.base58CheckSerialize(PaymentAddressType), " => wait for balance change with token", tokenID);
        let maxWaitTime = this.timeout;
        const startBalance = await this.getBalance(tokenID);
        let balance = startBalance;
        while (balance==startBalance){
            try {
                maxWaitTime = await this.sleepCapped(1000, maxWaitTime);
                balance = await this.getBalance(tokenID);
                // console.debug('balance is', balance);
            } catch (e) {
                throw new CustomError(ErrorObject.GetTxByHashErr, e.message);
            }
        }
        return {
            oldBalance: startBalance,
            balance
        }
    }

    // getAllPrivacyTokenBalance returns list of privacy token's balance
    /**
     *
     * @returns [{TokenID: string, Balance: number}]
     */
    async getAllPrivacyTokenBalance() {
        try {
            // get list privacy token
            let privacyTokens = await this.rpc.listTokens();
            let pTokenList = privacyTokens.listPrivacyToken;

            // get balance for each privacy token
            let tasks = [];
            for (let i = 0; i < pTokenList.length; i++) {
                let tokenID = pTokenList[i].ID;

                const tokenBalanceItemPromise = new Promise((resolve) => {
                    this.getBalance(tokenID, -1)
                        .then(balance => {
                            resolve({
                                TokenID: tokenID,
                                Balance: balance,
                            });
                        })
                        .catch(() => null)
                });
                tasks.push(tokenBalanceItemPromise);
            }

            const allResult = await Promise.all(tasks);
            const hasBalanceResult = allResult && allResult.filter(r => r && r.Balance > 0)

            return hasBalanceResult;
        } catch (e) {

            throw e;
        }
    }

    /**
     *
     * @param {{paymentAddressStr: string (B58checkencode), amount: number, message: "" }} paramPaymentInfos
     * @param {number} fee
     * @param {bool} isPrivacy
     * @param {string} info
     */
    async createAndSendNativeToken(
      paramPaymentInfos,
      fee,
      info = "",
      isEncryptMessageOutCoin = false,
      metadata = null,
      txHandler,
    ) {
        // check fee
        if (fee < 0) {
            fee = 0
        }

        let messageForNativeToken = "";
        if (paramPaymentInfos.length > 0) {
            messageForNativeToken = paramPaymentInfos[0].message;
        }
        await Wallet.updateProgressTx(10);

        const isEncodeOnly = !isEncryptMessageOutCoin;
        paramPaymentInfos = await encryptMessageOutCoin(paramPaymentInfos, isEncodeOnly);

        try {
            let result = await this.doPRVTransactionV2(paramPaymentInfos, fee, metadata, info);
            this.saveNormalTxHistory(result, false, "", messageForNativeToken);
            await Wallet.updateProgressTx(100);
            return result;
        } catch (e) {
            await Wallet.updateProgressTx(0);
            throw e;
        }
    };

    async doPRVTransactionV2(paramPaymentInfos, fee, metadata, info = "", tokenID = null, tokenPayments = null, tokenParams = null, txHandler) {
        info = base64Encode(stringToBytes(info));

        let receiverPaymentAddrStr = new Array(paramPaymentInfos.length);
        let totalAmountTransfer = new bn(0);
        for (let i = 0; i < paramPaymentInfos.length; i++) {
            receiverPaymentAddrStr[i] = paramPaymentInfos[i].PaymentAddress;
            totalAmountTransfer = totalAmountTransfer.add(new bn(paramPaymentInfos[i].Amount));
            paramPaymentInfos[i].Amount = new bn(paramPaymentInfos[i].Amount).toString();
        }

        let inputForTx;
        try {
            inputForTx = await prepareInputForTxV2(totalAmountTransfer, fee, null, this, this.rpc);
        } catch(e) {
            throw new CustomError(ErrorObject.InitNormalTxErr, "Error while preparing inputs", e);
        }

        if (inputForTx.inputCoinStrs.length > MAX_INPUT_PER_TX) {
            throw new CustomError(ErrorObject.TxSizeExceedErr);
        }
        await Wallet.updateProgressTx(30);

        let txParams = newParamTxV2(
            this.key,
            paramPaymentInfos,
            inputForTx.inputCoinStrs,
            fee,
            null,
            metadata,
            info,
            inputForTx.coinsForRing
        );
        // handle token transfer
        let tokenReceiverPaymentAddrStr = [];
        let totalAmountTokenTransfer = new bn(0);
        let inputForToken = {
            inputCoinStrs: [],
            coinsForRing: {}
        };
        // tokenID is non-null when transferring token; tokenParams is non-null when creating new token
        if (tokenPayments){
            let isInit = Boolean(tokenParams);
            let isTransfer = Boolean(tokenID);
            if (!(isInit || isTransfer)){
                throw new CustomError(ErrorObject.InitNormalTxErr, "Invalid Token parameters");
            }
            tokenReceiverPaymentAddrStr = new Array(tokenPayments.length);
            for (let i = 0; i < tokenPayments.length; i++) {
                receiverPaymentAddrStr[i] = tokenPayments[i].PaymentAddress;
                totalAmountTokenTransfer = totalAmountTokenTransfer.add(new bn(tokenPayments[i].Amount));
                tokenPayments[i].Amount = new bn(tokenPayments[i].Amount).toString();
            }
            if (isTransfer){
                try{
                    inputForToken = await prepareInputForTxV2(totalAmountTokenTransfer, 0, tokenID, this, this.rpc);
                }catch(e){
                    throw new CustomError(ErrorObject.InitNormalTxErr, "Error while preparing inputs");
                }
            }
            tokenParams = newTokenParamV2(
                tokenPayments,
                inputForToken.inputCoinStrs,
                tokenID,
                inputForToken.coinsForRing,
                tokenParams || {}
            );
            txParams.TokenParams = tokenParams;
        }
        // console.log("params are",txParams);

        let txParamsJson = JSON.stringify(txParams);
        let theirTime = await this.rpc.getNodeTime();
        let wasmResult = await wasm.createTransaction(txParamsJson, theirTime);
        let { b58EncodedTx, hash } = JSON.parse(wasmResult);
        console.log(`Encoded TX : ${b58EncodedTx}, Hash : ${hash}`);
        if (b58EncodedTx === null || b58EncodedTx === "") {
            throw new CustomError(ErrorObject.InitNormalTxErr, "Can not init transaction tranfering PRV");
        }
        let tempBuf = checkDecode(b58EncodedTx).bytesDecoded;
        let theString = new TextDecoder("utf-8").decode(tempBuf);
        let txObj = JSON.parse(theString);
        txObj.Encoded = b58EncodedTx;
        // console.log("TX: ", txObj);
        // console.log("Encoded: ", b58EncodedTx)

        await Wallet.updateProgressTx(60);
        let response;
        try {
            response = await this.send(b58EncodedTx, Boolean(tokenPayments));
        } catch (e) {
            throw new CustomError(ErrorObject.SendTxErr, "Can not send PRV transaction", e);
        }
        await Wallet.updateProgressTx(90)
        // console.log("Received", response)
        if (response.TokenID && response.TokenID.length>0){
            tokenID = response.TokenID;
        }
        return {
            Response: response,
            Tx: txObj,
            Hash: hash,
            Amount: totalAmountTransfer.toNumber(),
            Inputs: inputForTx.inputCoinStrs,
            Receivers: receiverPaymentAddrStr,
            TokenID: tokenID,
            TokenAmount: totalAmountTokenTransfer.toNumber(),
            TokenInputs: inputForToken.inputCoinStrs,
            TokenReceivers: tokenReceiverPaymentAddrStr,
            IsPrivacy: true,
            Metadata: metadata,
        }
    }

    async send(encodedTx, isToken){
        if (this.offlineMode){
            return {"offline": true}
        }
        let response;
        if (isToken){
            response = await this.rpc.sendRawTxCustomTokenPrivacy(encodedTx);
        }else{
            response = await this.rpc.sendRawTx(encodedTx);
        }
        return response;
    }

    async createAndSendConvertTx(paramPaymentInfos, fee, info = "", isEncryptMessageOutCoin = false) {
        // check fee
        if (fee < 0) {
            fee = 0
        }
        let messageForNativeToken = "";
        if (paramPaymentInfos.length > 0) {
            messageForNativeToken = paramPaymentInfos[0].Message;
        }
        await Wallet.updateProgressTx(10);
        const isEncodeOnly = !isEncryptMessageOutCoin;
        paramPaymentInfos = await encryptMessageOutCoin(paramPaymentInfos, isEncodeOnly);

        try {
            let result = await this.doConvertTx(paramPaymentInfos, fee, info);
            this.saveNormalTxHistory(result, false, "", messageForNativeToken);
            await Wallet.updateProgressTx(100);
            return result;
        } catch (e) {
            await Wallet.updateProgressTx(0);
            throw e;
        }
    };

    async createAndSendTokenConvertTx(tokenID, prvPaymentInfo, tokenPaymentInfo, fee, info = "", isEncryptMessage = false, isEncryptMessageToken = false) {
        // check fee
        if (fee < 0) {
            fee = 0
        }
        let messageForNativeToken = "";
        if (prvPaymentInfo.length > 0) {
            messageForNativeToken = prvPaymentInfo[0].Message;
        }
        await Wallet.updateProgressTx(10);
        let isEncodeOnly = !isEncryptMessage;
        prvPaymentInfo = await encryptMessageOutCoin(prvPaymentInfo, isEncodeOnly);
        isEncodeOnly = !isEncryptMessageToken;
        tokenPaymentInfo = await encryptMessageOutCoin(tokenPaymentInfo, isEncodeOnly);

        await Wallet.updateProgressTx(30);

        try {
            let result = await this.doConvertTx(prvPaymentInfo, fee, info, tokenID, tokenPaymentInfo);
            this.saveNormalTxHistory(result, false, "", messageForNativeToken);
            await Wallet.updateProgressTx(100);
            return result;
        } catch (e) {
            await Wallet.updateProgressTx(0);

            throw e;
        }
    };

    async doConvertTx(paramPaymentInfos, fee, info, tokenID = null, tokenPayments = null, numOfDefragInputs = 0) {
        info = base64Encode(stringToBytes(info));

        let metadata = null;
        let receiverPaymentAddrStr = new Array(paramPaymentInfos.length);
        let totalAmountTransfer = new bn(0);
        for (let i = 0; i < paramPaymentInfos.length; i++) {
            receiverPaymentAddrStr[i] = paramPaymentInfos[i].PaymentAddress;
            totalAmountTransfer = totalAmountTransfer.add(new bn(paramPaymentInfos[i].Amount));
            paramPaymentInfos[i].Amount = new bn(paramPaymentInfos[i].Amount).toString();
        }
        let isTokenConvert = (tokenID && tokenPayments);
        let isDefrag = numOfDefragInputs > 0;
        if (isDefrag && isTokenConvert){
            throw new CustomError(ErrorObject.SendTxErr, "Error: token defragment is not supported");
        }
        let inputForTx;
        try{
            if (isTokenConvert){
                // converting token. We need v2 PRV coins
                inputForTx = await prepareInputForTxV2(totalAmountTransfer, fee, null, this, this.rpc);
            }else{
                // 0 means convert, otherwise we defrag
                if (isDefrag){
                    inputForTx = await prepareInputForTxV2(-1, fee, null, this, this.rpc, 2, 20, numOfDefragInputs);
                }else{
                    inputForTx = await prepareInputForTxV2(-1, fee, null, this, this.rpc, 1, 0);
                }
            }
        }catch(e){
            throw new CustomError(ErrorObject.SendTxErr, "Can not prepare inputs", e);
        }
        if (inputForTx.inputCoinStrs.length > MAX_INPUT_PER_TX) {
            throw new CustomError(ErrorObject.TxSizeExceedErr);
        }
        await Wallet.updateProgressTx(30);

        let txParams = newParamTxV2(
            this.key,
            paramPaymentInfos,
            inputForTx.inputCoinStrs,
            fee,
            null,
            null,
            info,
            inputForTx.coinsForRing
        );
        // handle token transfer
        let tokenReceiverPaymentAddrStr = [];
        let totalAmountTokenTransfer = new bn(0);
        let inputForToken = {};
        if (isTokenConvert){
            tokenReceiverPaymentAddrStr = new Array(tokenPayments.length);
            for (let i = 0; i < tokenPayments.length; i++) {
                receiverPaymentAddrStr[i] = tokenPayments[i].PaymentAddress;
                totalAmountTokenTransfer = totalAmountTokenTransfer.add(new bn(tokenPayments[i].Amount));
                tokenPayments[i].Amount = new bn(tokenPayments[i].Amount).toString();
            }
            inputForToken = await prepareInputForTxV2(-1, 0, tokenID, this, this.rpc, 1, 0);
            let tokenParams = newTokenParamV2(
                tokenPayments,
                inputForToken.inputCoinStrs,
                tokenID,
                inputForToken.coinsForRing
            );
            txParams.TokenParams = tokenParams;
        }
        // console.log("params are",txParams);

        let txParamsJson = JSON.stringify(txParams);
        let wasmResult;
        let theirTime = await this.rpc.getNodeTime();
        if (isDefrag){
            wasmResult = await wasm.createTransaction(txParamsJson, theirTime);
        }else{
            wasmResult = await wasm.createConvertTx(txParamsJson, theirTime);
        }
        let { b58EncodedTx, hash } = JSON.parse(wasmResult);
        console.log(`Encoded TX : ${b58EncodedTx}, Hash : ${hash}`);
        if (b58EncodedTx === null || b58EncodedTx === "") {
            throw new CustomError(ErrorObject.InitNormalTxErr, "Can not init transaction tranfering PRV");
        }
        let tempBuf = checkDecode(b58EncodedTx).bytesDecoded;
        let theString = new TextDecoder("utf-8").decode(tempBuf);
        let txObj = JSON.parse(theString);
        txObj.Encoded = b58EncodedTx;
        // console.log("TX: ", txObj);

        await Wallet.updateProgressTx(60);
        let response;
        try {
            response = await this.send(b58EncodedTx, (tokenID && tokenPayments));
        } catch (e) {
            throw new CustomError(ErrorObject.SendTxErr, "Can not send PRV transaction", e);
        }
        await Wallet.updateProgressTx(90)
        return {
            Response: response,
            Tx: txObj,
            Hash: hash,
            Amount: totalAmountTransfer.toNumber(),
            Inputs: inputForTx.inputCoinStrs,
            Receivers: receiverPaymentAddrStr,
            TokenAmount: totalAmountTokenTransfer.toNumber(),
            TokenInputs: inputForToken.inputCoinStrs,
            TokenReceivers: tokenReceiverPaymentAddrStr,
            IsPrivacy: true,
            Metadata: metadata,
        }
    }

    // staking tx always send PRV to burning address with no privacy
    // type: 0 for shard
    // type: 1 for beacon
    /**
     *
     * @param {{type: number}} param
     * @param {number} feeNativeToken
     * @param {string} candidatePaymentAddress
     * @param {string} candidateMiningSeedKey
     * @param {string} rewardReceiverPaymentAddress
     * @param {bool} autoReStaking
     */
    async createAndSendStakingTx(param, feeNativeToken, candidatePaymentAddress, candidateMiningSeedKey, rewardReceiverPaymentAddress, autoReStaking = true) {
        await Wallet.updateProgressTx(10);
        // check fee
        if (feeNativeToken < 0) {
            feeNativeToken = 0
        }
        // get amount staking
        let amountBN = new bn("1750000000000", 10);
        let feeBN = new bn(feeNativeToken);

        // generate committee key
        let candidateKeyWallet = base58CheckDeserialize(candidatePaymentAddress);
        let publicKeyBytes = candidateKeyWallet.KeySet.PaymentAddress.Pk;
        let candidateHashPrivateKeyBytes = checkDecode(candidateMiningSeedKey).bytesDecoded;
        let committeeKey;
        try {
            committeeKey = await generateCommitteeKeyFromHashPrivateKey(candidateHashPrivateKeyBytes, publicKeyBytes);
        } catch (e) {
            throw e;
        }
        let paymentAddressStr = this.key.base58CheckSerialize(PaymentAddressType);

        let type = param.type === ShardStakingType ? MetaStakingShard : MetaStakingBeacon;

        let meta = {
            Type: type,
            FunderPaymentAddress: paymentAddressStr,
            RewardReceiverPaymentAddress: rewardReceiverPaymentAddress,
            StakingAmountShard: amountBN.toString(),
            CommitteePublicKey: committeeKey,
            AutoReStaking: autoReStaking,
        };

        let burningAddress = await getBurningAddress(Wallet.RpcClient);
        let paramPaymentInfos = [
            {
                paymentAddressStr: burningAddress,
                amount: amountBN.toString(),
                message: ""
            }
        ];

        let messageForNativeToken = paramPaymentInfos[0].message;

        try {
            let result = await this.doPRVTransactionV2(paramPaymentInfos, feeNativeToken, meta, "");
            this.saveNormalTxHistory(result, false, "", messageForNativeToken);
            await Wallet.updateProgressTx(100);
            return result;
        } catch (e) {
            await Wallet.updateProgressTx(0);
            throw e;
        }
    }

    // staking tx always send PRV to burning address with no privacy
    // type: 0 for shard
    // type: 1 for beacon
    /**
     *
     * @param {{type: number}} param
     * @param {number} feeNativeToken
     * @param {string} candidatePaymentAddress
     * @param {string} candidateMiningSeedKey
     * @param {string} rewardReceiverPaymentAddress
     * @param {bool} autoReStaking
     */
    async createAndSendStopAutoStakingTx(feeNativeToken, candidatePaymentAddress, candidateMiningSeedKey) {
        await Wallet.updateProgressTx(10);
        // check fee
        if (feeNativeToken < 0) {
            feeNativeToken = 0
        }
        let amountBN = new bn(0);
        let feeBN = new bn(feeNativeToken);

        // generate committee key
        let candidateKeyWallet = base58CheckDeserialize(candidatePaymentAddress);
        let publicKeyBytes = candidateKeyWallet.KeySet.PaymentAddress.Pk;

        let candidateHashPrivateKeyBytes = checkDecode(candidateMiningSeedKey).bytesDecoded;

        const committeeKey = await generateCommitteeKeyFromHashPrivateKey(candidateHashPrivateKeyBytes, publicKeyBytes);

        let meta = {
            Type: StopAutoStakingMeta,
            CommitteePublicKey: committeeKey
        };

        let burningAddress = await getBurningAddress(this.rpc);
        let paramPaymentInfos = [{
            paymentAddressStr: burningAddress,
            amount: "0",
            message: ""
        }];
        let messageForNativeToken = paramPaymentInfos[0].Message;

        try {
            let result = await this.doPRVTransactionV2(paramPaymentInfos, feeNativeToken, meta, "");
            this.saveNormalTxHistory(result, false, "", messageForNativeToken);
            await Wallet.updateProgressTx(100);
            return result;
        } catch (e) {

            throw e;
        }
    }

    /**
     *
     * @param {{paymentAddressStr: string, amount: number, message: string}} paramPaymentInfosForNativeToken
     * @param {{Privacy: bool, TokenID: string, TokenName: string, TokenSymbol: string, TokenTxType: bool, TokenAmount: number, TokenReceivers : [{PaymentAddress: string, Amount: number, Message: string}]}} submitParam
     * @param {number} feeNativeToken
     * @param {number} feePToken
     * @param {bool} hasPrivacyForNativeToken
     * @param {bool} hasPrivacyForPToken
     * @param {string} info
     */
    async createAndSendPrivacyToken(
        tokenID,
        prvPaymentInfo = [],
        tokenPaymentInfo,
        feeNativeToken,
        info = "",
        isEncryptMessageOutCoinNativeToken = false,
        isEncryptMessageOutCoinPToken = false,
        tokenParams = {},
        metadata = null,
        txHandler,
    ) {
        await Wallet.updateProgressTx(10);
        if (feeNativeToken < 0) {
            feeNativeToken = 0
        }

        let messageForNativeToken = "";
        if (prvPaymentInfo.length > 0) {
            messageForNativeToken = prvPaymentInfo[0].message;
        }
        let messageForPToken = tokenPaymentInfo[0].Message;
        let isEncodeOnly = !isEncryptMessageOutCoinNativeToken;
        prvPaymentInfo = await encryptMessageOutCoin(prvPaymentInfo, isEncodeOnly);
        isEncodeOnly = !isEncryptMessageOutCoinPToken;
        tokenPaymentInfo = await encryptMessageOutCoin(tokenPaymentInfo, isEncodeOnly);

        try {
            let result = await this.doPRVTransactionV2(prvPaymentInfo, feeNativeToken, metadata, info, tokenID, tokenPaymentInfo, tokenParams);
            this.saveNormalTxHistory(result, false, "", messageForNativeToken);
            await Wallet.updateProgressTx(100);
            return result;
        } catch (e) {
            await Wallet.updateProgressTx(0);
            throw e;
        }
    };

    // recursively sweep up everything into one UTXO
    async defragmentNativeCoin(fee, noOfInputPerTx = MaxInputNumberForDefragment) {

        await Wallet.updateProgressTx(10);
        const info = "defragment";

        // loop up to 30 times
        const MAX_ITERATIONS = 100;
        for (let i=0;i<MAX_ITERATIONS;i++){
            try{
                let inputForTx;
                try{
                    inputForTx = await prepareInputForTxV2(-1, fee, null, this, this.rpc, 2, 0, noOfInputPerTx);
                }catch(e){
                    throw new CustomError(ErrorObject.InitNormalTxErr, "Error while preparing inputs", e);
                }
                if (inputForTx.inputCoinStrs.length==1){
                    break;
                }
                console.log("Now combining", inputForTx.inputCoinStrs.length, "coins in 1 send");
                try {
                    let result = await this.doConvertTx([], fee, info, null, null, noOfInputPerTx);
                    console.log("Sent Defrag TX: ", result.Response.TxID);
                    const confs = 2;
                    console.log(`Waiting for ${confs} block confirmation`);
                    await this.waitTx(result.Response.TxID, confs);

                } catch (e) {
                    throw e;
                }
            } catch (e) {
                await Wallet.updateProgressTx(0);
                throw e;
            }
        }
    }

    // async defragmentNativeCoin(
    //   fee,
    //   isPrivacy = true,
    //   noOfInputPerTx = MaxInputNumberForDefragment,
    //   maxTxs = MAX_DEFRAGMENT_TXS,
    // ) {
    //     Wallet.Debug = "Starting...";
    //     await Wallet.updateProgressTx(10);
    //     const info = "Defragment";
    //     const feeBN = new bn(fee);
    //     const senderSkStr = this.key.base58CheckSerialize(PriKeyType);
    //     const senderPaymentAddressStr = this.key.base58CheckSerialize(PaymentAddressType);
    //
    //     try {
    //         Wallet.Debug = "Preparing...";
    //         const inputForTxs = _.take((await prepareInputForDefragments(PRVIDSTR, this, noOfInputPerTx)), maxTxs);
    //         await Wallet.updateProgressTx(20);
    //         const rawTxs = [];
    //         let index = 0;
    //
    //         if (!inputForTxs || !inputForTxs.length) {
    //             throw new CustomError(ErrorObject.NoAvailableUTXO, "No available UTXO");
    //         }
    //
    //         Wallet.Debug = 'INIT ALL TX';
    //         const initTxProcess = 70;
    //         const startProcess = 20;
    //         const totalTxs = inputForTxs.length;
    //         for (const inputInfo of inputForTxs) {
    //             console.debug('INIT RAW TX', `${index}/${totalTxs}`, inputInfo.inputCoinStrs.length);
    //             Wallet.Debug = `INIT RAW TX ${index}/${totalTxs} ${inputInfo.inputCoinStrs.length}`;
    //
    //             const paymentInfos = [{
    //                 paymentAddressStr: senderPaymentAddressStr,
    //                 amount: inputInfo.totalValueInput.sub(feeBN).toString(),
    //             }];
    //
    //             const nOutput = 1;
    //             const sndOutputs = new Array(nOutput);
    //             const sndOutputStrs = await wasmFuncs.randomScalars(nOutput.toString());
    //             const sndDecodes = base64Decode(sndOutputStrs);
    //             for (let i = 0; i < nOutput; i++) {
    //                 const sndBytes = sndDecodes.slice(i * ED25519_KEY_SIZE, (i + 1) * ED25519_KEY_SIZE);
    //                 sndOutputs[i] = checkEncode(sndBytes, ENCODE_VERSION);
    //             }
    //
    //             const paramInitTx = newParamInitTx(
    //               senderSkStr,
    //               paymentInfos,
    //               inputInfo.inputCoinStrs,
    //               feeBN.toString(),
    //               isPrivacy,
    //               PRVIDSTR,
    //               null,
    //               info,
    //               inputInfo.commitmentIndices,
    //               inputInfo.myCommitmentIndices,
    //               inputInfo.commitmentStrs,
    //               sndOutputs);
    //
    //             const paramInitTxJson = JSON.stringify(paramInitTx);
    //             const resInitTx = await wasmFuncs.initPrivacyTx(paramInitTxJson);
    //
    //             if (resInitTx === null || resInitTx === "") {
    //                 throw new CustomError(ErrorObject.InitNormalTxErr, "Can not init transaction tranfering PRV");
    //             }
    //
    //             const resInitTxBytes = base64Decode(resInitTx);
    //             const b58CheckEncodeTx = checkEncode(resInitTxBytes.slice(0, resInitTxBytes.length - 8), ENCODE_VERSION);
    //
    //             // get lock time tx
    //             const lockTimeBytes = resInitTxBytes.slice(resInitTxBytes.length - 8);
    //
    //             rawTxs.push({
    //                 raw: b58CheckEncodeTx,
    //                 totalAmount: inputInfo.totalValueInput,
    //                 lockTimeBytes,
    //                 inputInfo,
    //                 totalAmountString: inputInfo.totalValueInput.toString(),
    //                 totalInput: inputInfo.inputCoinStrs.length,
    //             });
    //             index++;
    //             await Wallet.updateProgressTx(startProcess + Math.floor(index / totalTxs * initTxProcess));
    //         }
    //         await Wallet.updateProgressTx(90);
    //
    //         const responses = [];
    //
    //         index = 0;
    //         Wallet.Debug = `SEND RAW TX BEGIN`;
    //         for (const rawTx of rawTxs) {
    //             const {
    //                 lockTimeBytes,
    //                 inputInfo,
    //                 raw,
    //                 totalAmount,
    //             } = rawTx;
    //
    //             Wallet.Debug = `SEND RAW TX ${index++}/${totalTxs} ${inputInfo.inputCoinStrs.length}`;
    //
    //             const lockTime = new bn(lockTimeBytes).toNumber();
    //             const response = await Wallet.RpcClient.sendRawTx(raw);
    //             const listUTXOForPRV = [];
    //
    //             // saving history tx
    //             // check status of tx and add coins to spending coins
    //             let status = FailedTx;
    //             if (response.txId) {
    //                 // tx.txId = response.txId
    //                 status = SuccessTx;
    //                 response.typeTx = TxNormalType;
    //                 response.feeNativeToken = feeBN.toString();
    //                 response.lockTime = lockTime;
    //                 response.amountNativeToken = totalAmount.toString();
    //                 response.txStatus = status;
    //
    //                 // add spending list
    //                 let spendingSNs = [];
    //                 for (let i = 0; i < inputInfo.inputCoinStrs.length; i++) {
    //                     spendingSNs.push(inputInfo.inputCoinStrs[i].SerialNumber);
    //                     listUTXOForPRV.push(inputInfo.inputCoinStrs[i].SNDerivator);
    //                 }
    //                 this.addSpendingCoins({
    //                     txID: response.txId,
    //                     spendingSNs: spendingSNs,
    //                 });
    //             }
    //             this.saveNormalTxHistory(response, [senderPaymentAddressStr], false, isPrivacy, listUTXOForPRV, "", null, info, "");
    //             responses.push(response);
    //         }
    //         await Wallet.updateProgressTx(100);
    //
    //         return responses;
    //     } catch (e) {
    //         console.debug('ERROR', e);
    //
    //         throw new CustomError(ErrorObject.SendTxErr, "Can not send PRV transaction", e);
    //     } finally {
    //         Wallet.Debug = '';
    //         await Wallet.updateProgressTx(0);
    //     }
    // }

    // createAndSendBurningRequestTx create and send tx burning ptoken when withdraw
    // remoteAddress (string) is an ETH/BTC address which users want to receive ETH/BTC (without 0x)
    /**
     *
     * @param {...{paymentAddressStr: string, amount: number, message: string}} paramPaymentInfosForNativeToken
     * @param {{Privacy: bool, TokenID: string, TokenName: string, TokenSymbol: string, TokenTxType: bool, TokenAmount: number, TokenReceivers : {PaymentAddress: string, Amount: number, Message: string}}} submitParam
     * @param {number} feeNativeToken
     * @param {number} feePToken
     * @param {string} remoteAddress
     */
    async createAndSendBurningRequestTx(
        prvPaymentInfo = [],
        fee,
        burningTokenID,
        remoteAddress,
        burnAmount,
        info = "",
        burningType = BurningRequestMeta,
        isEncryptMessageOutCoinNativeToken = false,
        isEncryptMessageOutCoinPToken = false,
        txHandler,
    ) {
        if (remoteAddress.startsWith("0x")) {
            remoteAddress = remoteAddress.slice(2);
        }
        if (fee < 0) {
            fee = 0
        }
        await Wallet.updateProgressTx(10);

        let burningAddress = await getBurningAddress(this.rpc);
        let tokenPaymentInfo = [{
            PaymentAddress: burningAddress,
            Amount: new bn(burnAmount).toString(),
            Message: ""
        }];
        let messageForNativeToken = "";
        if (prvPaymentInfo.length>0){
            messageForNativeToken = prvPaymentInfo[0].Message;
        }
        let isEncodeOnly = !isEncryptMessageOutCoinNativeToken;
        prvPaymentInfo = await encryptMessageOutCoin(prvPaymentInfo, isEncodeOnly);
        isEncodeOnly = !isEncryptMessageOutCoinPToken;
        tokenPaymentInfo = await encryptMessageOutCoin(tokenPaymentInfo, isEncodeOnly);
        await Wallet.updateProgressTx(30);

        let addrForMd = addressToUnmarshallable(this.key.KeySet.PaymentAddress);
        const paymentAddressStr = this.key.base58CheckSerialize(PaymentAddressType);

        // prepare meta data for tx
        let burningReqMetadata = {
            BurnerAddress: addrForMd,
            BurningAmount: burnAmount,
            TokenID: burningTokenID,
            RemoteAddress: remoteAddress,
            Type: burningType,
        };
        try {
            let result = await this.doPRVTransactionV2(prvPaymentInfo, fee, burningReqMetadata, info, burningTokenID, tokenPaymentInfo);
            this.saveNormalTxHistory(result, false, "", messageForNativeToken);
            await Wallet.updateProgressTx(100);
            return result;
        } catch (e) {
            await Wallet.updateProgressTx(0);
            throw e;
        }
    };

    // getRewardAmount returns amount rewards
    // if isGetAll is true: return all of reward types (such as PRV, pToken,..)
    /**
     *
     * @param {string} paymentAddrStr
     * @param {bool} isGetAll
     * @param {string} tokenID
     * @returns {number} (if isGetAll = false)
     * @returns {map[TokenID] : number} (if isGetAll = true)
     */
    static async getRewardAmount(paymentAddrStr, isGetAll = true, tokenID = "") {
        let resp;
        try {
            resp = await this.rpc.getRewardAmount(paymentAddrStr);
        } catch (e) {

            throw new CustomError(ErrorObject.GetRewardAmountErr, "Can not get reward amount");
        }

        if (isGetAll) {
            return resp.rewards;
        } else {
            if (tokenID === "") {
                tokenID = "PRV";
            }

            return resp.rewards[tokenID];
        }
    }

    // createAndSendWithdrawRewardTx create and send tx withdraw reward amount
    /**
     *
     * @param {string} tokenID
     */
    async createAndSendWithdrawRewardTx(fee, tokenID = null) {

        if (!tokenID || tokenID === "") {
            tokenID = convertHashToStr(PRVID)
        }

        // let senderSkStr = this.key.base58CheckSerialize(PriKeyType);
        // let paymentAddressStr = this.key.base58CheckSerialize(PaymentAddressType);
        let addrForMd = addressToUnmarshallable(this.key.KeySet.PaymentAddress);
        let md = {
            Type: WithDrawRewardRequestMeta,
            PaymentAddress: addrForMd,
            TokenID: tokenID
        };

        try {
            let result = await this.doPRVTransactionV2([], fee, md, "");
            this.saveNormalTxHistory(result, false, "", "");
            await Wallet.updateProgressTx(100);
            return result;
        } catch (e) {
            await Wallet.updateProgressTx(0);
            throw e;
        }
    }

    /*
    * @param {number} fee
    * @param {string} pdeContributionPairID
    * @param {number} sellAmount
    * @param {string} info
    */
    async createAndSendWithdrawDexTx(fee, withdrawalToken1IDStr, withdrawalToken2IDStr, withdrawalShareAmt, info = "") {
        await Wallet.updateProgressTx(10);
        if (!withdrawalToken1IDStr || withdrawalToken1IDStr === "") {
            withdrawalToken1IDStr = convertHashToStr(PRVID)
        }
        if (!withdrawalToken2IDStr || withdrawalToken2IDStr === "") {
            withdrawalToken2IDStr = convertHashToStr(PRVID)
        }

        // let addrForMd = addressToUnmarshallable(this.key.KeySet.PaymentAddress);
        let md = {
            WithdrawerAddressStr: this.key.base58CheckSerialize(PaymentAddressType),
            WithdrawalToken1IDStr: withdrawalToken1IDStr,
            WithdrawalToken2IDStr: withdrawalToken2IDStr,
            WithdrawalShareAmt: new bn(withdrawalShareAmt).toString(),
            Type: PDEWithdrawalRequestMeta,
        };
        try {
            let result = await this.doPRVTransactionV2([], fee, md, "");
            this.saveNormalTxHistory(result, false, "", "");
            await Wallet.updateProgressTx(100);
            return result;
        } catch (e) {
            await Wallet.updateProgressTx(0);
            throw e;
        }
    }

    // toSerializedAccountObj returns account with encoded key set
    toSerializedAccountObj() {
        return {
            "AccountName": this.name,
            "PrivateKey": this.key.base58CheckSerialize(PriKeyType),
            "PaymentAddress": this.key.base58CheckSerialize(PaymentAddressType),
            "ReadonlyKey": this.key.base58CheckSerialize(ReadonlyKeyType),
            "PublicKey": this.key.getPublicKeyByHex(),
            "PublicKeyCheckEncode": this.key.getPublicKeyCheckEncode(),
            "PublicKeyBytes": this.key.KeySet.PaymentAddress.Pk.toString(),
            "ValidatorKey": checkEncode(hashSha3BytesToBytes(hashSha3BytesToBytes(this.key.KeySet.PrivateKey)), ENCODE_VERSION),
        }
    }

    /**
     *
     */
    // stakerStatus return status of staker
    // return object {{Role: int, ShardID: int}}
    // Role: -1: is not staked, 0: candidate, 1: validator
    // ShardID: beacon: -1, shardID: 0->MaxShardNumber
    async stakerStatus() {
        let blsPubKeyB58CheckEncode = await this.key.getBLSPublicKeyB58CheckEncode();


        let reps;
        try {
            reps = await this.rpc.getPublicKeyRole("bls:" + blsPubKeyB58CheckEncode);
        } catch (e) {
            throw e;
        }

        return reps.status;
    }


    /********************** DEX **********************/
    /**
     *
     * @param {number} fee
     * @param {string} pdeContributionPairID
     * @param {number} contributedAmount
     * @param {string} info
     */
    async createAndSendTxWithContribution(fee, pdeContributionPairID, contributedAmount, info = "", tokenIDStr = null) {
        if (fee < 0) {
            fee = 0
        }
        let burningAddress = await getBurningAddress(this.rpc);
        let paramPaymentInfos = [{
            PaymentAddress: burningAddress,
            Amount: new bn(contributedAmount).toString(),
            Message: ""
        }];
        let messageForNativeToken = paramPaymentInfos[0].Message;
        await Wallet.updateProgressTx(10);

        let contributorAddressStr = this.key.base58CheckSerialize(PaymentAddressType);
        let isToken = true;
        if (!tokenIDStr){
            isToken = false;
            tokenIDStr = convertHashToStr(PRVID);
        }
        // prepare meta data for tx
        let metadata = {
            PDEContributionPairID: pdeContributionPairID,
            ContributorAddressStr: contributorAddressStr,
            ContributedAmount: contributedAmount,
            TokenIDStr: tokenIDStr,
            Type: PDEPRVRequiredContributionRequestMeta,
        };

        try {
            let result;
            if (isToken){
                result = await this.doPRVTransactionV2([], fee, metadata, info, tokenIDStr, paramPaymentInfos);
            }else{
                result = await this.doPRVTransactionV2(paramPaymentInfos, fee, metadata, info);
            }
            this.saveNormalTxHistory(result, false, "", messageForNativeToken);
            await Wallet.updateProgressTx(100);
            return result;
        } catch (e) {
            await Wallet.updateProgressTx(0);
            throw e;
        }
    };

    /**
     *
     * @param {number} fee
     * @param {string} pdeContributionPairID
     * @param {number} sellAmount
     * @param {number} minimumAcceptableAmount
     * @param {number} tradingFee
     * @param {string} info
     */
    async createAndSendNativeTokenTradeRequestTx(fee, tokenIDToBuyStr, sellAmount, minimumAcceptableAmount, tradingFee, info = "", tokenIDToSellStr) {
        await Wallet.updateProgressTx(10);
        if (fee < 0) {
            fee = 0
        }
        await Wallet.updateProgressTx(10);
        let prv = convertHashToStr(PRVID);
        let sellPRV = false;
        if (!tokenIDToSellStr || tokenIDToSellStr==prv){
            sellPRV = true;
            tokenIDToSellStr = prv;
        }
        let buyPRV = false;
        if (!tokenIDToBuyStr || tokenIDToBuyStr==prv){
            buyPRV = true;
            tokenIDToBuyStr = prv;
        }

        const burningAddress = await getBurningAddress(this.rpc);
        let amount = tradingFee;
        let tokenPaymentInfos = [];
        if (sellPRV){
            amount += sellAmount;
        }else{
            tokenPaymentInfos = [{
                PaymentAddress: burningAddress,
                Amount: sellAmount,
                Message: "",
            }];
        }

        const prvPaymentInfos = [{
            PaymentAddress: burningAddress,
            Amount: amount,
            Message: "",
        }];

        let messageForNativeToken = prvPaymentInfos[0].Message;

        let myAddressStr = this.key.base58CheckSerialize(PaymentAddressType);
        let pInf = {
            PaymentAddress: myAddressStr,
            Amount: "0"
        }
        let newCoin;
        try {
            // since we only use the PublicKey and TxRandom fields, the tokenID is irrelevant
            let temp = await wasm.createCoin(JSON.stringify({PaymentInfo : pInf, TokenID: null}));
            newCoin = JSON.parse(temp);
            await Wallet.updateProgressTx(20);
        }catch(e){
            await Wallet.updateProgressTx(0);
            throw e;
        }
        console.log("created new OTA in", newCoin);

        let newCoinForSub;
        try {
            let temp = await wasm.createCoin(JSON.stringify({PaymentInfo : pInf, TokenID: null}));
            newCoinForSub = JSON.parse(temp);
        }catch(e){
            throw e;
        }

        // prepare meta data for tx. It is normal trade request at first
        let metadata = {
            TokenIDToBuyStr: tokenIDToBuyStr,
            TokenIDToSellStr: tokenIDToSellStr,
            SellAmount: sellAmount,
            Type: PDECrossPoolTradeRequestMeta,
            MinAcceptableAmount: minimumAcceptableAmount,
            TradingFee: tradingFee,
            TraderAddressStr: newCoin.PublicKey,
            TxRandomStr: newCoin.TxRandom,
            SubTraderAddressStr: newCoinForSub.PublicKey,
            SubTxRandomStr: newCoinForSub.TxRandom,
        };

        let paramInitTx = newParamInitPrivacyTokenTx(
          senderSkStr,
          paramPaymentInfosForNativeToken,
          inputForTx.inputCoinStrs,
          feeNativeBN.toString(),
          false,
          false,
          tokenParamJson,
          metadata,
          "",
          inputForTx.commitmentIndices,
          inputForTx.myCommitmentIndices,
          inputForTx.commitmentStrs,
          sndOutputsForNativeToken,
          inputForPrivacyTokenTx.commitmentIndices,
          inputForPrivacyTokenTx.myCommitmentIndices,
          inputForPrivacyTokenTx.commitmentStrs,
          sndOutputsForPToken,
        );

        let resInitTx;
        let paramInitTxJson = JSON.stringify(paramInitTx);
        resInitTx = await wasmFuncs.initPTokenTradeTx(paramInitTxJson);
        if (resInitTx === null || resInitTx === "") {
            throw new CustomError(ErrorObject.InitNormalTxErr, "Can not init transaction tranfering PRV");
        }



        //base64 decode txjson
        let resInitTxBytes = base64Decode(resInitTx);

        // get b58 check encode tx json
        let b58CheckEncodeTx = checkEncode(resInitTxBytes.slice(0, resInitTxBytes.length - 8), ENCODE_VERSION);

        // get lock time tx
        let lockTimeBytes = resInitTxBytes.slice(resInitTxBytes.length - 8);
        let lockTime = new bn(lockTimeBytes).toNumber();

        await Wallet.updateProgressTx(80);

        let response;
        try {
            response = await Wallet.RpcClient.sendRawTxCustomTokenPrivacy(b58CheckEncodeTx);
        } catch (e) {
            throw new CustomError(ErrorObject.SendTxErr, "Can not send privacy token tx", e);
        }

        await Wallet.updateProgressTx(90);
        // saving history tx
        // check status of tx
        let listUTXOForPRV = [];
        let listUTXOForPToken = [];
        // check status of tx and add coins to spending coins
        let status = FailedTx;
        if (response.txId) {
            status = SuccessTx;
            response.typeTx = TxCustomTokenPrivacyType;
            response.feeNativeToken = new bn(feeNativeToken).toString();
            response.feePToken = new bn(feePToken).toString();
            response.lockTime = lockTime;
            response.amountNativeToken = amountTransferPRV.toString();
            response.amountPToken = amountTransferPToken.toString();
            response.txStatus = status;
            response.tokenName = tokenParamJson.propertyName;
            response.tokenID = tokenParamJson.propertyID;
            response.tokenSymbol = tokenParamJson.propertySymbol;
            response.tokenTxType = tokenParamJson.tokenTxType;

            // add spending list
            let spendingSNs = [];
            for (let i = 0; i < inputForTx.inputCoinStrs.length; i++) {
                spendingSNs.push(inputForTx.inputCoinStrs[i].SerialNumber);
                listUTXOForPRV.push(inputForTx.inputCoinStrs[i].SNDerivator);
            }

            for (let i = 0; i < inputForPrivacyTokenTx.tokenInputs.length; i++) {
                listUTXOForPToken.push(inputForPrivacyTokenTx.tokenInputs[i].SNDerivator);
            }

            this.addSpendingCoins({ txID: response.txId, spendingSNs: spendingSNs });

        }

        let isIn = false;
        this.savePrivacyTokenTxHistory(response, [burningAddress], isIn, false, false, listUTXOForPRV, listUTXOForPToken, "", metadata,
          "", "", messageForPToken);
        await Wallet.updateProgressTx(100);
        return response;
    };

    /**
     *
     * @param {number} fee
     * @param {string} pdeContributionPairID
     * @param {number} sellAmount
     * @param {string} info
     */
    async createAndSendWithdrawDexTx(fee, withdrawalToken1IDStr, withdrawalToken2IDStr, withdrawalShareAmt, info = "") {
        await Wallet.updateProgressTx(10);

        if (fee < 0) {
            fee = 0
        }

        let feeBN = new bn(fee);
        let isPrivacy = false;    // always false
        let paramPaymentInfos = [];
        let totalAmountTransfer = new bn(0);


        let senderSkStr = this.key.base58CheckSerialize(PriKeyType);
        // let paymentAddressStr = this.key.base58CheckSerialize(PaymentAddressType);
        // let viewingKeyStr = this.key.base58CheckSerialize(ReadonlyKeyType);

        try {
            let result;
            if (sellPRV){
                result = await this.doPRVTransactionV2(prvPaymentInfos, fee, metadata, info);
            }else{
                result = await this.doPRVTransactionV2(prvPaymentInfos, fee, metadata, info, tokenIDToSellStr, tokenPaymentInfos);
            }
            this.saveNormalTxHistory(result, false, "", messageForNativeToken);
            await Wallet.updateProgressTx(100);
            return result;
        } catch (e) {
            await Wallet.updateProgressTx(0);
            throw e;
        }
    };

    async getReceivedTransaction() {
        let rpcClient = this.rpc;
        // call api to get info from node
        const paymentAddress = this.key.base58CheckSerialize(PaymentAddressType);
        const viewingKey = this.key.base58CheckSerialize(ReadonlyKeyType);

        // cal rpc to get data
        let txs = await this.rpc.getTransactionByReceiver(paymentAddress, viewingKey);
        txs = txs.receivedTransactions;
        if (txs.length > 0) {
            this.txReceivedHistory.NormalTx = [];
            this.txReceivedHistory.PrivacyTokenTx = [];
            this.txReceivedHistory.CustomTokenTx = [];
        }
        for (let i = 0; i < txs.length; i++) {
            // loop and parse into history tx object
            const tx = txs[i].TransactionDetail;

            let messageForNativeToken = "";
            let messageForPToken = "";
            if (txs[i].ReceivedAmounts[PRVIDSTR]) {
                try{
                    messageForNativeToken = await decryptMessageOutCoin(this, txs[i].TransactionDetail.ProofDetail.OutputCoins[0].Info);
                }catch (e){
                    messageForNativeToken = txs[i].TransactionDetail.ProofDetail.OutputCoins[0].Info;
                    console.log("Skipping message because", e); // skip
                }
            }
            if (txs[i].ReceivedAmounts[tx.PrivacyCustomTokenID]) {
                console.log(txs[i].TransactionDetail.PrivacyCustomTokenProofDetail)
                try{
                    messageForPToken = await decryptMessageOutCoin(this, this, txs[i].TransactionDetail.PrivacyCustomTokenProofDetail.OutputCoins[0].Info);
                }catch (e){
                    messageForPToken = txs[i].TransactionDetail.PrivacyCustomTokenProofDetail.OutputCoins[0].Info;
                    console.log("Skipping message because", e); // skip
                }
            }

            let infoDecode = tx.Info;
            if (infoDecode) {
                infoDecode = checkDecode(tx.Info).bytesDecoded;
                infoDecode = bytesToString(infoDecode);
            }
            // console.log("TX", tx);

            try {
                const historyObj = {
                    txID: tx.Hash,
                    amountNativeToken: txs[i].ReceivedAmounts[PRVIDSTR], // in nano PRV
                    amountPToken: txs[i].ReceivedAmounts[tx.PrivacyCustomTokenID],
                    feeNativeToken: tx.Fee, // in nano PRV
                    feePToken: tx.PrivacyCustomTokenFee,
                    typeTx: tx.Type,
                    receivers: null,
                    tokenName: tx.PrivacyCustomTokenName,
                    tokenID: tx.PrivacyCustomTokenID,
                    tokenSymbol: tx.PrivacyCustomTokenIDSymbol,
                    isIn: true,
                    time: (new Date(tx.LockTime)).getTime(), // in mili-second
                    status: null,
                    isPrivacyNativeToken: true,
                    isPrivacyForPToken: true,
                    listUTXOForPRV: [],
                    listUTXOForPToken: [],
                    hashOriginalTx: "",
                    metaData: tx.Metadata,
                    info: infoDecode,
                    messageForNativeToken: messageForNativeToken,
                    messageForPToken: messageForPToken,
                };

                let txHistoryInfo = new TxHistoryInfo();
                txHistoryInfo.setHistoryInfo(historyObj);
                switch (tx.Type) {
                    case TxNormalType:
                        {
                            this.txReceivedHistory.NormalTx.push(txHistoryInfo);
                            break;
                        }
                    case TxCustomTokenPrivacyType:
                        {
                            this.txReceivedHistory.PrivacyTokenTx.push(txHistoryInfo)
                            break;
                        }
                }
            } catch (e) {
                throw e;
            }
        }
        return this.txReceivedHistory;
    };

    async generateIncognitoContractAddress(privateKey) {
        return generateIncognitoContractAddress(JSON.stringify({
            privateKey,
        }));
    }

    sleep(ms){
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    sleepCapped(ms, maxSeconds){
        // console.debug("Wait up to", maxSeconds);
        if (maxSeconds<=0){
            throw new CustomError(ErrorObject.UnexpectedErr, "wait time depleted");
        }
        maxSeconds -= ms/1000;
        return this.sleep(ms)
        .then(_ => maxSeconds);
    }

    async waitTx(txId, confirmations = 5) {
        console.debug(txId, " => wait for", confirmations, "confirmations");
        let maxWaitTime = this.timeout;
        let blockHash = null;
        let response;
        while (!blockHash){
            try {
                response = await this.rpc.getTransactionByHash(txId);
                if (response.blockHash.length==64){
                    blockHash = response.blockHash;
                }else{
                    maxWaitTime = await this.sleepCapped(1000, maxWaitTime);
                }
            } catch (e) {
                throw new CustomError(ErrorObject.GetTxByHashErr, e.message);
            }
        }

        maxWaitTime = 200;
        let currentConfs = 0;
        while (currentConfs < confirmations){
            try {
                response = await this.rpc.getBlockByHash(blockHash);
                let c = response.Confirmations;
                // console.debug(c, "confirmations");
                if (c){
                    currentConfs = c;
                }
                maxWaitTime = await this.sleepCapped(1000, maxWaitTime);
            } catch (e) {
                throw new CustomError(ErrorObject.GetTxByHashErr, e.message);
            }
        }
        console.debug("Confirmed !")
    }

    async waitHeight(height = 10) {
        console.debug("Waiting for beacon height to reach", height);
        let maxWaitTime = this.timeout;
        let done = false;
        let response;
        while (!done){
            try {
                response = await this.rpc.getBeaconBestState();
                if (response.bestState.BeaconHeight >= height){
                    done = true;
                }else{
                    maxWaitTime = await this.sleepCapped(1000, maxWaitTime);
                }
            } catch (e) {
                throw new CustomError(ErrorObject.GetTxByHashErr, e.message);
            }
        }
        console.debug("Completed !")
    }

    async setPrivacy(wasmFile = './privacy.wasm') {
        await load(wasmFile);
    }

    async getDeserializeInformation() {
        const privateKey = this.key.base58CheckSerialize(PriKeyType);

        if (deserializedAccounts[privateKey]) {
            return {
                ...deserializedAccounts[privateKey],
                "AccountName": this.name,
            };
        }

        const miningSeedKey = hashSha3BytesToBytes(hashSha3BytesToBytes(this.key.KeySet.PrivateKey));
        const blsPublicKey = await generateBLSPubKeyB58CheckEncodeFromSeed(miningSeedKey);

        const information = {
            "ID": getChildIdFromChildNumberArray(this.key.ChildNumber),
            "AccountName": this.name,
            "PrivateKey": privateKey,
            "PaymentAddress": this.key.base58CheckSerialize(PaymentAddressType),
            "ReadonlyKey": this.key.base58CheckSerialize(ReadonlyKeyType),
            "PublicKey": this.key.getPublicKeyByHex(),
            "PublicKeyCheckEncode": this.key.getPublicKeyCheckEncode(),
            "ValidatorKey": checkEncode(miningSeedKey, ENCODE_VERSION),
            "BLSPublicKey": blsPublicKey,
            "PublicKeyBytes": this.key.KeySet.PaymentAddress.Pk.toString(),
        };

        deserializedAccounts[privateKey] = information;

        return information;
    }

    getPrivateKey() {
        return this.key.base58CheckSerialize(PriKeyType);
    }

    async updateAllTransactionsStatus() {
        if (this.txHistory) {
            if (this.txHistory.NormalTx) {
                for (let j = 0; j < this.txHistory.NormalTx.length; j++) {
                    // get transaction was sended successfully
                    if (this.txHistory.NormalTx[j].status === SuccessTx) {
                        let txID = this.txHistory.NormalTx[j].txID;

                        let response;
                        try {
                            response = await Wallet.RpcClient.getTransactionByHash(this.txHistory.NormalTx[j].txID);
                        } catch (e) {
                            throw new CustomError(ErrorObject.GetTxByHashErr, e.message || "Can not get normal transaction by hash");
                        }

                        if (response.isInBlock) {
                            // transaction was confirmed
                            this.txHistory.NormalTx[j].status = ConfirmedTx;
                        } else if (!response.isInBlock && !response.isInMempool && response.err !== null) {
                            // transaction is not existed in mempool and block
                            this.txHistory.NormalTx[j].status = FailedTx;
                        }

                        // update spending coins list
                        if (this.txHistory.NormalTx[j].status === ConfirmedTx ||
                          this.txHistory.NormalTx[j].status === FailedTx){
                            this.removeObjectFromSpendingCoins(txID);
                            this.save(this.PassPhrase);
                        }
                    }
                }
            }

            if (this.txHistory.CustomTokenTx) {
                for (let j = 0; j < this.txHistory.CustomTokenTx.length; j++) {
                    // get transaction was sended successfully
                    if (this.txHistory.CustomTokenTx[j].status === SuccessTx) {
                        let response;
                        try {
                            response = await Wallet.RpcClient.getTransactionByHash(this.txHistory.CustomTokenTx[j].txID);
                        } catch (e) {
                            throw new CustomError(ErrorObject.GetTxByHashErr, e.message || "Can not get custom token transaction by hash");
                        }

                        if (response.isInBlock) {
                            // transaction was confirmed
                            this.txHistory.CustomTokenTx[j].status = ConfirmedTx;
                        } else if (!response.isInBlock && !response.isInMempool && response.err !== null) {
                            // transaction is not existed in mempool and block
                            this.txHistory.CustomTokenTx[j].status = FailedTx;
                        }
                    }
                }
            }

            if (this.txHistory.PrivacyTokenTx) {
                for (let j = 0; j < this.txHistory.PrivacyTokenTx.length; j++) {
                    // get transaction was sended successfully
                    if (this.txHistory.PrivacyTokenTx[j].status === SuccessTx) {
                        let response;
                        try {
                            response = await Wallet.RpcClient.getTransactionByHash(this.txHistory.PrivacyTokenTx[j].txID);
                        } catch (e) {
                            throw new CustomError(ErrorObject.GetTxByHashErr, e.message || "Can not get privacy token transaction by hash");
                        }

                        if (response.isInBlock) {
                            // transaction was confirmed
                            this.txHistory.PrivacyTokenTx[j].status = ConfirmedTx;
                        } else if (!response.isInBlock && !response.isInMempool && response.err !== null) {
                            // transaction is not existed in mempool and block
                            this.txHistory.PrivacyTokenTx[j].status = FailedTx;
                        }
                    }
                }
            }
        }
    }

    async getShardId() {
        const Pk = account.key.KeySet.PaymentAddress.Pk;
        const lastByte = Pk[Pk.length - 1];
        return lastByte % ShardNumber;
    }
}

export {
    Transactor
};
