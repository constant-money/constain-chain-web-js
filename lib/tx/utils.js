import bn from 'bn.js';
import {
    CustomTokenParamTx
} from "../tx/txcustomtokendata";
import {
    MAX_INPUT_PER_TX
} from '../tx/constants';
import {
    CustomError,
    ErrorObject
} from '../common/errorhandler';
import {
    base64Encode
} from '../privacy/utils';
import {
    getShardIDFromLastByte
} from '../common/common';
import {
    defaultCoinChooser as coinChooser
} from '../extended/coinChooser';
import _ from 'lodash';

const prepareInputForTxV2 = async(amountTransfer, fee, tokenID, account, rpcClient, inputVersion = "2", numOfOtherPks = 20, maxInputs = MAX_INPUT_PER_TX) => {
    const unspentCoinStrs = await account.getUnspentToken(tokenID, inputVersion);
    // remove spending coins from list of unspent coins
    let unspentCoinExceptSpendingCoin;
    try {
        unspentCoinExceptSpendingCoin = getUnspentCoinExceptSpendingCoin(unspentCoinStrs, account);
    } catch (e) {
        console.error("Coin storage error", e)
    };
    // console.log("coins are", unspentCoinExceptSpendingCoin, "from", unspentCoinStrs);
    // total amount transfer and fee
    let feeBN = new bn(fee);
    let inputCoinsToSpent;
    if (amountTransfer < 0){
    	// negative means use all inputs
    	let arrayEnd = MAX_INPUT_PER_TX;
    	if (unspentCoinExceptSpendingCoin.length < arrayEnd){
    		arrayEnd = unspentCoinExceptSpendingCoin.length;
    	}
    	inputCoinsToSpent = unspentCoinExceptSpendingCoin.slice(0, arrayEnd);
    	amountTransfer = feeBN;
    }else{
	    amountTransfer = amountTransfer.add(feeBN);
	    const respChooseBestCoin = coinChooser.coinsToSpend(unspentCoinExceptSpendingCoin, amountTransfer);
	    inputCoinsToSpent = respChooseBestCoin.resultInputCoins;
	    if (inputCoinsToSpent.length === 0 && amountTransfer.cmp(new bn(0)) !== 0) {
	        throw new CustomError(ErrorObject.NotEnoughCoinError, "Not enough coin to spend");
	    }
	}

    let totalValueInput = new bn(0);
    for (let i = 0; i < inputCoinsToSpent.length; i++) {
        totalValueInput = totalValueInput.add(new bn(inputCoinsToSpent[i].Value));
        inputCoinsToSpent[i].Info = "";
    }
    // console.log('will use', inputCoinsToSpent);
    // const paymentAddrSerialize = account.key.base58CheckSerialize(PaymentAddressType);
    const shardID = getShardIDFromLastByte(account.key.KeySet.PaymentAddress.Pk[(account.key.KeySet.PaymentAddress.Pk.length - 1)]);
    let cc = null;
    try{
	    if (numOfOtherPks>0){
			cc = await coinChooser.coinsForRing(rpcClient, shardID, numOfOtherPks, tokenID);
	    }
	}catch(e){
		console.error("Error while preparing input parameters", e);
		throw e;
	}
    let res = {
        // PaymentAddress: paymentAddrSerialize,
        inputCoinStrs: inputCoinsToSpent,
        totalValueInput: totalValueInput,
        coinsForRing: cc
    };
    return res;
};

const prepareInputForDefragments = async (coinId, account, noInputPerTx) => {
    Wallet.Debug = 'Getting coins...';
    const unspentCoinExceptSpendingCoin = (await account.getUnspentToken(coinId));
    const sortedUnspentCoins = _.orderBy(unspentCoinExceptSpendingCoin, item => item.Value);
    const parts = _.chunk(sortedUnspentCoins, noInputPerTx);
    return parts;
};

// cloneInputCoinArray clone array of input coins to new array
const cloneInputCoinJsonArray = (_coins) =>
    _coins.map(c => JSON.parse(JSON.stringify(c)));

const getUnspentCoinExceptSpendingCoin = (unspentCoinStrs, account) => {
    if (account.spendingCoins) {
        if (account.spendingCoins.length) {
            let unspentCoinExceptSpendingCoin = cloneInputCoinJsonArray(unspentCoinStrs);
            for (let i = 0; i < account.spendingCoins.length; i++) {
                for (let j = 0; j < account.spendingCoins[i].spendingSNs.length; j++) {
                    for (let k = 0; k < unspentCoinExceptSpendingCoin.length; k++) {
                        //
                        //
                        if (account.spendingCoins[i].spendingSNs[j] === unspentCoinExceptSpendingCoin[k].KeyImage) {
                            unspentCoinExceptSpendingCoin.splice(k, 1);
                        }
                    }
                }
            }

            return unspentCoinExceptSpendingCoin;
        }
    }

    return unspentCoinStrs;
}

// getUnspentCoin returns unspent coins
const getUnspentCoin = async(paymentAddrSerialize, inCoinStrs, tokenID, rpcClient) => {
    let unspentCoinStrs = new Array();
    let serialNumberStrs = new Array();

    for (let i = 0; i < inCoinStrs.length; i++) {
        serialNumberStrs.push(inCoinStrs[i].KeyImage);
    }

    // console.log("SNs are", serialNumberStrs, "from", inCoinStrs);

    // check whether each input coin is spent or not
    let response;
    try {
        response = await rpcClient.hasSerialNumber(paymentAddrSerialize, serialNumberStrs, tokenID);
    } catch (e) {
        throw e;
    }

    let existed = response.existed;
    if (existed.length != inCoinStrs.length) {
        throw new Error("Wrong response when check has serial number");
    }

    for (let i = 0; i < existed.length; i++) {
        if (!existed[i]) {
            unspentCoinStrs.push(inCoinStrs[i]);
        }
    }

    return {
        unspentCoinStrs: unspentCoinStrs
    };
};

function newParamTxV2(senderKeyWalletObj, paymentInfos, inputCoins, fee, tokenID, metadata, info, otherCoinsForRing) {
    let sk = base64Encode(senderKeyWalletObj.KeySet.PrivateKey);
    let param = {
        "SenderSK": sk,
        "PaymentInfo": paymentInfos,
        "InputCoins": inputCoins,
        "Fee": fee,
        "HasPrivacy": true,
        "TokenID": tokenID,
        "Metadata": metadata,
        "Info": info,
        "CoinCache": otherCoinsForRing
    };

    return param
}

function newTokenParamV2(paymentInfos, inputCoins, tokenID, otherCoinsForRing, obj = {}){
    obj.PaymentInfo = paymentInfos
    obj.InputCoins = inputCoins
    obj.TokenID = tokenID
    obj.CoinCache = otherCoinsForRing
    return obj
}

export {
    prepareInputForTxV2,
    cloneInputCoinJsonArray,
    getUnspentCoinExceptSpendingCoin,
    getUnspentCoin,
    newParamTxV2,
    newTokenParamV2,
};
