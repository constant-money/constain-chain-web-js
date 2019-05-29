import bn from 'bn.js';
import { checkDecode, checkEncode } from "../base58";
import { KeyWallet as keyWallet } from "../wallet/hdwallet";
import { knapsack, greedy } from '../knapsack';
import { InputCoin } from '../coin';
import { P256 } from "privacy-js-lib/lib/ec";
import { PaymentProof } from '../payment';
import { TxTokenVin, TxTokenVout, CustomTokenParamTx } from "../tx/txcustomtokendata";
import { newHashFromStr } from "../common";
import { CustomTokenPrivacyParamTx, Wallet } from "../wallet/wallet";
import { PaymentInfo } from "../key";
import {
  ENCODE_VERSION, 
  SIG_PUB_KEY_SIZE,
  SIG_NO_PRIVACY_SIZE,
  SIG_PRIVACY_SIZE,
} from "../constants";
import { PaymentAddressType, ReadonlyKeyType, MaxTxSize} from '../wallet/constants';
import { CustomTokenInit, CustomTokenTransfer, MaxInputNumberForDefragment } from '../tx/constants';

// prepareInputForTx prepare inputs for constant tx
const prepareInputForTx = async (spendingKeyStr, paymentInfos, fee, account, rpcClient) => {
  // deserialize spending key string to key wallet
  let myKeyWallet = keyWallet.base58CheckDeserialize(spendingKeyStr);
  // import key set
  myKeyWallet.KeySet.importFromPrivateKey(myKeyWallet.KeySet.PrivateKey);

  // serialize payment address, readonlyKey
  let paymentAddrSerialize = myKeyWallet.base58CheckSerialize(PaymentAddressType);
  let readOnlyKeySerialize = myKeyWallet.base58CheckSerialize(ReadonlyKeyType);

  // get all output coins of spendingKey
  let response;
  try{
    response = await rpcClient.getOutputCoin(paymentAddrSerialize, readOnlyKeySerialize);
  } catch(e){
    throw e;
  }
  
  let allOutputCoinStrs = response.outCoins;
  // if (allOutputCoinStrs.length == 0) {
  //   throw new Error('Balance is zero');
  // }

  // devide all of output coins into uncached and cached out put coins list
  const { uncachedOutputCoinStrs, cachedOutputCoinStrs, cachedInputCoins } = account.analyzeOutputCoinFromCached(allOutputCoinStrs);
  let inputCoins = cachedInputCoins
  // console.log("Input coin cached: analyzeOutputCoinFromCached : ", inputCoins);

  // parse input coins from input coins string (encoded) and cache
  if (uncachedOutputCoinStrs.length > 0) {
    let uncachedInputCoins = parseInputCoinFromEncodedObject(uncachedOutputCoinStrs, account.key, account.derivatorPointCached);
    // merge derivator cached point with derivator cached json
    account.mergeDerivatorCached(); 
    account.mergeInputCoinJsonCached(uncachedOutputCoinStrs, uncachedInputCoins);
    inputCoins = inputCoins.concat(uncachedInputCoins);
    allOutputCoinStrs = cachedOutputCoinStrs.concat(uncachedOutputCoinStrs);
  }

  // get unspent coin from cache
  let { unspentInputCoinsFromCached, unspentInputCoinsFromCachedStrs } = account.analyzeSpentCoinFromCached(inputCoins, allOutputCoinStrs);

  // check whether unspent coin from cache is spent or not
  let { unspentCoins } = await getUnspentCoin(unspentInputCoinsFromCached, paymentAddrSerialize, unspentInputCoinsFromCachedStrs, null, rpcClient);

  // remove spending coins from list of unspent coins
  let unspentCoinExceptSpendingCoin = getUnspentCoinExceptSpendingCoin(unspentCoins, account);
  // console.log("unspentCoinExceptSpeningCoin: ", unspentCoinExceptSpeningCoin);

  // calculate amount which need to be spent
  let amount = new bn(0);
  for (let i = 0; i < paymentInfos.length; i++) {
    amount = amount.add(paymentInfos[i].Amount);
  }
  amount = amount.add(fee);

  let respChooseBestCoin;
  try {
    respChooseBestCoin = chooseBestCoinToSpent(unspentCoinExceptSpendingCoin, amount);
  } catch (e) {
    console.log("Error when chooseBestCoinToSpent", e)
    throw e;
  }

  let inputCoinsToSpent = respChooseBestCoin.resultOutputCoins;

  if (inputCoinsToSpent.length == 0 && amount.cmp(new bn(0)) != 0) {
    throw new Error("Not enough coin")
  }

  // parse inputCoinsToSpent to encoded objects 
  let inputCoinsToSpentStr = parseInputCoinToEncodedObject(inputCoinsToSpent);

  return {
    senderKeySet: myKeyWallet.KeySet,
    paymentAddrSerialize: paymentAddrSerialize,
    inputCoins: inputCoinsToSpent,
    inputCoinStrs: inputCoinsToSpentStr
  };
};

const prepareInputForCustomTokenTx = async (spendingKeyStr, tokenParams, rpcClient) => {
  let senderKeyWallet = keyWallet.base58CheckDeserialize(spendingKeyStr);
  senderKeyWallet.KeySet.importFromPrivateKey(senderKeyWallet.KeySet.PrivateKey);

  let response;
  try {
    response = await rpcClient.listCustomTokens();
  } catch (e) {
    throw e;
  }

  let listCustomToken = response.listCustomToken;

  switch (tokenParams.tokenTxType) {
    case CustomTokenInit: {
      return {
        listCustomToken: listCustomToken,
        tokenVins: null,
      }
    }
    case CustomTokenTransfer: {
      // sum of custom tokens' value in tokenParams.receivers
      let vOutAmount = 0;
      for (let i = 0; i < tokenParams.receivers.length; i++) {
        vOutAmount += tokenParams.receivers[i].value;
      }

      // gêt unspent custom token with propertyID
      try {
        response = await rpcClient.getUnspentCustomToken(
          senderKeyWallet.base58CheckSerialize(PaymentAddressType),
          tokenParams.propertyID
        );
      } catch(e){
        throw e;
      }

      let listUnspentCustomToken = response.listUnspentCustomToken;
      
      if (listUnspentCustomToken.length === 0) {
        throw new Error("Balance of token is zero");
      }

      // get enough cutsom token for spending
      let tokenVins = new Array(0);
      let vinAmount = 0;

      for (let i = 0; i < listUnspentCustomToken.length; i++) {
        vinAmount += listUnspentCustomToken[i].Value;

        let tokenVoutsTmp = new TxTokenVout();
        tokenVoutsTmp.set(senderKeyWallet.KeySet.PaymentAddress, listUnspentCustomToken[i].Value);

        let tokenVinTmp = new TxTokenVin();
        tokenVinTmp.txCustomTokenID = newHashFromStr(listUnspentCustomToken[i].TxCustomTokenID);
        tokenVinTmp.voutIndex = listUnspentCustomToken[i].Index;
        tokenVinTmp.paymentAddress = senderKeyWallet.KeySet.PaymentAddress;
        // console.log(":senderKeyWallet1.KeySet.PaymentAddress: ", senderKeyWallet.KeySet.PaymentAddress);

        let signature = senderKeyWallet.KeySet.sign(tokenVoutsTmp.hash());
        tokenVinTmp.signature = checkEncode(signature, ENCODE_VERSION);

        tokenVins.push(tokenVinTmp);

        vOutAmount -= listUnspentCustomToken[i].Value;
        if (vOutAmount <= 0) {
          break;
        }
      }

      return {
        listCustomToken: listCustomToken,
        tokenVins: tokenVins,
        vinsAmount: vinAmount,
      }
    }
  }
};

const prepareInputForTxCustomTokenPrivacy = async (spendingKeyStr, tokenParams, account, rpcClient) => {
  console.log("Token param when preparing: ", tokenParams);
  let response;
  try {
    response = await rpcClient.listPrivacyCustomTokens();
  } catch(e){
    throw e;
  }
  let listPrivacyToken = response.listPrivacyToken;

  // paymentInfo for tx normal
  // tokenParams for tx custom token privacy data, but haven't tokenParam's tokenInputs
  switch (tokenParams.tokenTxType) {
    case CustomTokenInit: {
      return {
        tokenInputs: null,
        listPrivacyToken: listPrivacyToken
      }
    }
    case CustomTokenTransfer: {
      // deserialize spending key string to key wallet
      let myKeyWallet = keyWallet.base58CheckDeserialize(spendingKeyStr);

      // import key set
      myKeyWallet.KeySet.importFromPrivateKey(myKeyWallet.KeySet.PrivateKey);

      // serialize payment address, readonlyKey
      let paymentAddrSerialize = myKeyWallet.base58CheckSerialize(PaymentAddressType);
      let readOnlyKeySerialize = myKeyWallet.base58CheckSerialize(ReadonlyKeyType);

      // prepare tokenParams' tokenInputs for tx custom token privacy
      let amountTokenPrivacyOutput = new bn(0);
      for (let i = 0; i < tokenParams.receivers.length; i++) {
        amountTokenPrivacyOutput = amountTokenPrivacyOutput.add(tokenParams.receivers[i].Amount);
      }      

      let response;
      try{
        response = await rpcClient.getOutputCoin(paymentAddrSerialize, readOnlyKeySerialize, tokenParams.propertyID.toLowerCase());
      } catch(e){
        throw e;
      }
      let allOutputCoinStrs = response.outCoins;
      if (allOutputCoinStrs.length == 0) {
        throw new Error("Token's amount is zero");
      }

      // parse input coin from string
      // leftOutputCoinStrs: is not cached
      const { uncachedOutputCoinStrs, cachedOutputCoinStrs, cachedInputCoins } = account.analyzeOutputCoinFromCached(allOutputCoinStrs, tokenParams.propertyID.toLowerCase());
      let inputCoins = cachedInputCoins

      // console.log("Input coin cached: analyzeOutputCoinFromCached : ", inputCoins);

      // cache leftOutputCoinStrs
      if (uncachedOutputCoinStrs.length > 0) {
        let uncachedInputCoins = Wallet.RpcClient.parseInputCoinFromEncodedObject(uncachedOutputCoinStrs, account.key, account.derivatorPointCached);
        account.mergeDerivatorCached();
        account.mergeInputCoinJsonCached(uncachedOutputCoinStrs, uncachedInputCoins);
        inputCoins = inputCoins.concat(uncachedInputCoins);
        allOutputCoinStrs = cachedOutputCoinStrs.concat(uncachedOutputCoinStrs);
      }

      // get unspent coin from cache
      let { unspentInputCoinsFromCached, unspentInputCoinsFromCachedStrs } = account.analyzeSpentCoinFromCached(inputCoins, allOutputCoinStrs, tokenParams.propertyID.toLowerCase());

      // get list unspent coins from all of output coins
      let unspentOutputCoins;
      try {
        unspentOutputCoins = await getUnspentPrivacyCustomToken(unspentInputCoinsFromCached, paymentAddrSerialize, unspentInputCoinsFromCachedStrs, tokenParams.propertyID.toLowerCase(), rpcClient);
      } catch (e) {
        throw e;
      }

      // get coin to spent using Knapsack
      let tokenInputs;
      try {
        tokenInputs = chooseBestCoinToSpent(unspentOutputCoins.unspentCoin, amountTokenPrivacyOutput).resultOutputCoins;
      } catch (e) {
        throw e;
      }

      return {
        tokenInputs: tokenInputs,
        listPrivacyToken: listPrivacyToken,
      };
    }
  }

};

// parseInputCoinFromEncodedObject convert encoded input coins object to struct and calculate serial number
const parseInputCoinFromEncodedObject = (encodedCoinObjects, keyWallet, derivatorCached = {}, tokenID = 'constant') => {
  console.time("parseInputCoinFromEncodedObject: ")
  let inputCoins = new Array(encodedCoinObjects.length);
  const spendingKeyBN = new bn(keyWallet.KeySet.PrivateKey);

  for (let i = 0; i < encodedCoinObjects.length; i++) {
    // decode object coins
    let publicKeyDecode = checkDecode(encodedCoinObjects[i].PublicKey).bytesDecoded;
    let commitmentDecode = checkDecode(encodedCoinObjects[i].CoinCommitment).bytesDecoded;
    let sndDecode = checkDecode(encodedCoinObjects[i].SNDerivator).bytesDecoded;
    let randDecode = checkDecode(encodedCoinObjects[i].Randomness).bytesDecoded;

    inputCoins[i] = new InputCoin();
    inputCoins[i].coinDetails.publicKey = P256.decompress(publicKeyDecode);
    inputCoins[i].coinDetails.coinCommitment = P256.decompress(commitmentDecode);
    inputCoins[i].coinDetails.snderivator = new bn(sndDecode);
    inputCoins[i].coinDetails.randomness = new bn(randDecode);
    inputCoins[i].coinDetails.value = new bn(encodedCoinObjects[i].Value);
    inputCoins[i].coinDetails.info = checkDecode(encodedCoinObjects[i].Info).bytesDecoded;

    // calculate serial number for each coins
    // check whether each coin's snd is existed in derivatorCached or not
    const sndStr = `${tokenID}_${inputCoins[i].coinDetails.snderivator}`;
    let serialNumber = {};

    if (derivatorCached[sndStr] != undefined) {
      serialNumber = derivatorCached[sndStr];
    } else {
      serialNumber = P256.g.derive(spendingKeyBN, inputCoins[i].coinDetails.snderivator);
      derivatorCached[sndStr] = serialNumber;
    }

    inputCoins[i].coinDetails.serialNumber = serialNumber;
  }
  console.timeEnd("parseInputCoinFromEncodedObject: ")
  return inputCoins;
};

// parseInputCoinToEncodedObject convert input coin to encoded object
const parseInputCoinToEncodedObject = (coins) => {
  let encodedCoins = new Array(coins.length);

  for (let i = 0; i < encodedCoins.length; i++) {
    encodedCoins[i] = new Object();
    encodedCoins[i].PublicKey = checkEncode(coins[i].coinDetails.publicKey.compress(), ENCODE_VERSION);
    encodedCoins[i].CoinCommitment = checkEncode(coins[i].coinDetails.coinCommitment.compress(), ENCODE_VERSION);
    encodedCoins[i].SNDerivator = checkEncode(coins[i].coinDetails.snderivator.toArray(), ENCODE_VERSION);
    encodedCoins[i].Randomness = checkEncode(coins[i].coinDetails.randomness.toArray(), ENCODE_VERSION);
    encodedCoins[i].SerialNumber = null;
    encodedCoins[i].Value = coins[i].coinDetails.value;
    encodedCoins[i].Info = checkEncode(coins[i].coinDetails.info, ENCODE_VERSION);
  }

  return encodedCoins;
};

// chooseBestCoinToSpent return list of coins to spent using Knapsack and Greedy algorithm
const chooseBestCoinToSpent = (inputCoins, amount) => {
  console.log("HHHHHH amount: ", amount);
  console.log("HHHHHH inputCoins: ", inputCoins);

  console.time("chooseBestCoinToSpent")

  if (amount.cmp(new bn(0)) === 0) {
    return {
      resultOutputCoins: [],
      remainOutputCoins: inputCoins,
      totalResultOutputCoinAmount: 0
    }
  }

  let incoinUnknapsack = [];
  let incoinKnapsack = [];
  let valueKnapsack = [];
  let resultOutputCoins = [];
  let remainOutputCoins = [];
  let sumvalueKnapsack = new bn(0);

  for (let i = 0; i < inputCoins.length; i++) {
    if (inputCoins[i].coinDetails.value.cmp(amount) == 1) {
      incoinUnknapsack.push(inputCoins[i]);
    } else {
      sumvalueKnapsack = sumvalueKnapsack.add(inputCoins[i].coinDetails.value);
      valueKnapsack.push(inputCoins[i].coinDetails.value.toNumber());
      incoinKnapsack.push(inputCoins[i]);
    }
  }

  let target = sumvalueKnapsack.clone().sub(amount);
  let totalResultOutputCoinAmount = new bn(0);

  if (target.cmpn(1000) > 0) {
    // using Greedy algorithm
    console.log("target.cmpn(1000) > 0")
    inputCoins.sort(function (a, b) {
      return a.coinDetails.value.cmp(b.coinDetails.value)
    });

    let choiceIndex = greedy(inputCoins, amount);
    for (let i = 0; i <= choiceIndex; i++) {
      totalResultOutputCoinAmount = totalResultOutputCoinAmount.add(inputCoins[i].coinDetails.value);
      resultOutputCoins.push(inputCoins[i]);
    }

    for (let i = choiceIndex + 1; i < inputCoins.length; i++) {
      remainOutputCoins.push(inputCoins[i]);
    }
  } else if (target.cmpn(0) > 0) {
    console.log("target.cmpn(0) > 0")
    let choices = knapsack(valueKnapsack, target.toNumber());

    for (let i = 0; i < valueKnapsack.length; i++) {
      if (!choices[i]) {
        totalResultOutputCoinAmount = totalResultOutputCoinAmount.addn(valueKnapsack[i]);
        resultOutputCoins.push(inputCoins[i]);
      } else {
        remainOutputCoins.push(inputCoins[i]);
      }
    }
  } else if (target.cmpn(0) === 0) {
    console.log("target === 0")
    totalResultOutputCoinAmount = sumvalueKnapsack;
    resultOutputCoins = incoinKnapsack;
    remainOutputCoins = incoinUnknapsack;
  } else {
    console.log("target else");

    if (incoinUnknapsack.length === 0) {
      console.timeEnd("chooseBestCoinToSpent")
      throw new Error("Not enough constant");
    } else {
      let iMin = 0;
      for (let i = 1; i < incoinUnknapsack.length; i++) {
        iMin = (incoinUnknapsack[i].coinDetails.value.cmp(incoinUnknapsack[iMin].coinDetails.value) < 0) ? (i) : (iMin);
      }
      resultOutputCoins.push(incoinUnknapsack[iMin]);
      totalResultOutputCoinAmount = incoinUnknapsack[iMin].coinDetails.value.clone();
      for (let i = 0; i < incoinUnknapsack.length; i++) {
        if (i !== iMin) {
          remainOutputCoins.push(incoinUnknapsack[i]);
        }
      }
    }
  }

  console.timeEnd("chooseBestCoinToSpent")
  return {
    resultOutputCoins: cloneInputCoinArray(resultOutputCoins),
    remainOutputCoins: cloneInputCoinArray(remainOutputCoins),
    totalResultOutputCoinAmount: totalResultOutputCoinAmount
  };
};

// cloneInputCoinArray clone array of input coins to new array
const cloneInputCoinArray = (inputCoins) => {
  let inputCoinsClone = new Array(inputCoins.length);

  for (let i = 0; i < inputCoinsClone.length; i++) {
    inputCoinsClone[i] = new InputCoin()
    inputCoinsClone[i].coinDetails.set(inputCoins[i].coinDetails.publicKey, inputCoins[i].coinDetails.coinCommitment,
      inputCoins[i].coinDetails.snderivator, inputCoins[i].coinDetails.serialNumber, inputCoins[i].coinDetails.randomness,
      inputCoins[i].coinDetails.value, inputCoins[i].coinDetails.info);
  }
  return inputCoinsClone;
}

// paymentAddrSerialize, inputCoins, payments, hasPrivacy, metadata, customTokenParams, privacyCustomTokenParams
const estimateFee = async (paymentAddrSerialize, inputCoins, payments, hasPrivacy, metadata, rpcClient, customTokenParams = null, privacyCustomTokenParams = null) => {
  let unitFee;
  try{
    unitFee = await rpcClient.getEstimateFeePerKB(paymentAddrSerialize);
  } catch(e){
    throw e;
  }

  let txSize = estimateTxSize(inputCoins, payments, hasPrivacy, metadata, customTokenParams, privacyCustomTokenParams);
  console.log("TX size when estimate fee: ", txSize);

  // check tx size
  if (txSize > MaxTxSize) {
    throw new Error("Tx size is too large!")
  }

  console.log("++++++++++++++++++++++ Estimate Fee +++++++++++++++++++++")
  console.log("--------- inputCoins:", inputCoins)
  console.log("--------- payments:", payments)
  console.log("--------- hasPrivacy:", hasPrivacy)
  console.log("--------- customTokenParams:", customTokenParams)
  console.log("--------- privacyCustomTokenParams:", privacyCustomTokenParams)
  console.log("--------- txSize in Kb:", txSize)
  console.log("--------- unitFee:", unitFee.unitFee)
  console.log("++++++++++++++++++++++ End Estimate Fee +++++++++++++++++++++")

  return txSize * unitFee.unitFee; // mili constant
};

const getEstimateFee = async (from, to, amount, privatekeyStr, account, isPrivacy, rpcClient, customTokenParams = null, privacyCustomTokenParams = null) => {
  let receiverKeyWallet = keyWallet.base58CheckDeserialize(to);
  let paymentInfos = [];
  if (customTokenParams == null && privacyCustomTokenParams == null) {
    paymentInfos = new Array(1);
    paymentInfos[0] = new PaymentInfo(receiverKeyWallet.KeySet.PaymentAddress, new bn(amount));
  }
  // console.log("Amount when getEstimateFee: ", amount);
  // console.log("Amount BigInt when getEstimateFee: ", new bn(amount));
  // console.log("Payment info when getEstimateFee: ", paymentInfos);

  let inputForTx;
  try {
    inputForTx = await prepareInputForTx(privatekeyStr, paymentInfos, new bn(0), account, rpcClient);
  } catch (e) {
    throw e;
  }

  let fee;
  try {
    fee = await estimateFee(from, inputForTx.inputCoins, paymentInfos, isPrivacy, null, rpcClient, customTokenParams, privacyCustomTokenParams);
  } catch (e) {
    throw e;
  }

  return fee;
};

/**
 *
 * @param {string} from
 * @param {string} to
 * @param {number} amount
 * @param {{Privacy: boolean, TokenID: string, TokenName: string, TokenSymbol: string, TokenTxType: number TokenAmount: number, TokenReceivers: {[string]: number}}} tokenObject
 * @param {string} privateKeyStr
 */
const getEstimateFeeForSendingToken = async (from, to, amount, tokenObject, privatekeyStr, account, rpcClient, isPrivacyForPrivateToken) => {
  let id = "";
  let name = "";
  let symbol = "";
  if (tokenObject.TokenID !== null) {
    id = tokenObject.TokenID;
  }
  if (tokenObject.TokenName !== null) {
    name = tokenObject.TokenName;
  }
  if (tokenObject.TokenSymbol !== null) {
    symbol = tokenObject.TokenSymbol;
  }

  if (tokenObject.Privacy === false) {
    let receivers = new TxTokenVout();
    receivers.set(
      keyWallet.base58CheckDeserialize(tokenObject.TokenReceivers.PaymentAddress).KeySet.PaymentAddress, 
      tokenObject.TokenReceivers.Amount
    );

    let customTokenParams = new CustomTokenParamTx();
    customTokenParams.set(id, name, symbol,
      amount, tokenObject.TokenTxType, [receivers],
      [], tokenObject.TokenAmount);

    let inputForCustomTx;
    try {
      inputForCustomTx = await prepareInputForCustomTokenTx(privatekeyStr, customTokenParams, rpcClient);
      customTokenParams.vins = inputForCustomTx.tokenVins;
    } catch (e) {
      throw e;
    }

    let fee;
    try {
      fee = await getEstimateFee(from, to, amount, privatekeyStr, account, false, rpcClient, customTokenParams);
    } catch (e) {
      throw e;
    }

    return fee;
  } else if (tokenObject.Privacy === true) {
    let receivers = new PaymentInfo(
      keyWallet.base58CheckDeserialize(tokenObject.TokenReceivers.PaymentAddress).KeySet.PaymentAddress, 
      new bn(tokenObject.TokenReceivers.Amount)
    );

    let privacyCustomTokenParams = new CustomTokenPrivacyParamTx();
    privacyCustomTokenParams.set(id, name, symbol, amount, tokenObject.TokenTxType, [receivers], []);

    let inputForPrivacyCustomToken;
    try {
      inputForPrivacyCustomToken = await prepareInputForTxCustomTokenPrivacy(privatekeyStr, privacyCustomTokenParams, account, rpcClient);
      privacyCustomTokenParams.tokenInputs = inputForPrivacyCustomToken.tokenInputs;
    } catch (e) {
      throw e;
    }

    let fee;
    try {
      fee = await getEstimateFee(from, to, amount, privatekeyStr, account, isPrivacyForPrivateToken, rpcClient, null, privacyCustomTokenParams);
    } catch (e) {
      throw e;
    }
    return fee;
  }
}

const getEstimateFeeToDefragment = async (from, amount, privatekeyStr, account, isPrivacy, rpcClient) => {
  amount = new bn(amount);

  let senderPaymentAddress = keyWallet.base58CheckDeserialize(from);

  // totalAmount was paid for fee
  let defragmentUTXO, totalAmount;
  console.time("getUTXOsToDefragment")
  try {
    let result = await getUTXOsToDefragment(privatekeyStr, new bn(0), account, amount, rpcClient);
    console.log("getUTXOsToDefragment Done");
    defragmentUTXO = result.defragmentUTXO;
    totalAmount = result.totalAmount;
  } catch (e) {
    console.log(e);
    throw e;
  }

  console.timeEnd("getUTXOsToDefragment")
  console.log("defragmentUTXO len: ", defragmentUTXO.length);

  // create paymentInfos
  let paymentInfos = new Array(1);
  paymentInfos[0] = new PaymentInfo(
    senderPaymentAddress,
    totalAmount
  );

  let fee;
  try {
    fee = await estimateFee(from, defragmentUTXO, paymentInfos, isPrivacy, null, rpcClient);
  } catch (e) {
    throw e;
  }
  return fee;
};

const estimateTxSize = (inputCoins, payments, hasPrivacy, metadata, customTokenParams, privacyCustomTokenParams) => {
  let sizeVersion = 1; // int8
  let sizeType = 5;    // string, max : 5
  let sizeLockTime = 8; // int64
  let sizeFee = 8;      // uint64

  let sizeInfo = 0;
  if (hasPrivacy) {
    sizeInfo = 64;
  }
  let sizeSigPubKey = SIG_PUB_KEY_SIZE;
  let sizeSig = SIG_NO_PRIVACY_SIZE;
  if (hasPrivacy) {
    sizeSig = SIG_PRIVACY_SIZE;
  }

  let sizeProof = PaymentProof.estimateProofSize(inputCoins.length, payments.length, hasPrivacy);

  let sizePubKeyLastByte = 1;

  let sizeMetadata = 0;
  // if (metadata != null || typeof metadata !== "undefined"){
  //   sizeMetadata += metadata.CalculateSize()
  // }
  let sizeTx = sizeVersion + sizeType + sizeLockTime + sizeFee + sizeInfo + sizeSigPubKey + sizeSig + sizeProof + sizePubKeyLastByte + sizeMetadata;
  if (customTokenParams !== null && typeof customTokenParams !== "undefined") {
    let customTokenDataSize = 0;
    customTokenDataSize += customTokenParams.propertyID.length;
    customTokenDataSize += customTokenParams.propertySymbol.length;
    customTokenDataSize += customTokenParams.propertyName.length;
    customTokenDataSize += 8;
    customTokenDataSize += 4;
    console.log("************* customTokenParams.receivers: ", customTokenParams.receivers);
    console.log("************* customTokenParams.vins: ", customTokenParams.vins);

    for (let i = 0; i < customTokenParams.receivers.length; i++) {
      customTokenDataSize += customTokenParams.receivers[i].paymentAddress.toBytes().length;
      customTokenDataSize += 8;
    }

    if (customTokenParams.vins !== null) {
      for (let i = 0; i < customTokenParams.vins.length; i++) {
        customTokenDataSize += customTokenParams.vins[i].paymentAddress.toBytes().length;
        customTokenDataSize += customTokenParams.vins[i].txCustomTokenID.slice(0).length;
        customTokenDataSize += customTokenParams.vins[i].signature.length;
        customTokenDataSize += 4;
      }
      sizeTx += customTokenDataSize;
    }
  }
  if (privacyCustomTokenParams !== null && typeof privacyCustomTokenParams !== "undefined") {
    let customTokenDataSize = 0;

    customTokenDataSize += privacyCustomTokenParams.propertyID.length;
    customTokenDataSize += privacyCustomTokenParams.propertySymbol.length;
    customTokenDataSize += privacyCustomTokenParams.propertyName.length;

    customTokenDataSize += 8; // for amount
    customTokenDataSize += 4; // for TokenTxType
    customTokenDataSize += 1; // int8 version
    customTokenDataSize += 5; // string, max : 5 type
    customTokenDataSize += 8; // int64 locktime
    customTokenDataSize += 8; // uint64 fee

    customTokenDataSize += 64; // info

    customTokenDataSize += SIG_PUB_KEY_SIZE; // sig pubkey
    customTokenDataSize += SIG_PRIVACY_SIZE; // sig

    // Proof
    if (privacyCustomTokenParams.tokenInputs !== null) {
      customTokenDataSize += PaymentProof.estimateProofSize(privacyCustomTokenParams.tokenInputs.length, privacyCustomTokenParams.receivers.length, true);
    }
    customTokenDataSize += 1; //PubKeyLastByte
    sizeTx += customTokenDataSize

  }
  return Math.ceil(sizeTx / 1024.0) + 2; // buffer more 2 kb on tx size
};

const getUTXOsToDefragment = async (spendingKeyStr, fee, account, amount, rpcClient) => {
  // deserialize spending key string to key wallet
  let myKeyWallet = keyWallet.base58CheckDeserialize(spendingKeyStr);

  // import key set
  myKeyWallet.KeySet.importFromPrivateKey(myKeyWallet.KeySet.PrivateKey);

  // serialize payment address, readonlyKey
  let paymentAddrSerialize = myKeyWallet.base58CheckSerialize(PaymentAddressType);
  let readOnlyKeySerialize = myKeyWallet.base58CheckSerialize(ReadonlyKeyType);

  // get all output coins of spendingKey
  let response;
  try{
    response = await rpcClient.getOutputCoin(paymentAddrSerialize, readOnlyKeySerialize);
  } catch(e){
    throw e;
  }
  
  let allOutputCoinStrs = response.outCoins;

  if (allOutputCoinStrs.length == 0) {
    throw new Error('Have no item in list output coins');
  }

  // parse input coin from string
  // leftOutputCoinStrs: is not cached
  const { uncachedOutputCoinStrs, cachedOutputCoinStrs, cachedInputCoins } = account.analyzeOutputCoinFromCached(allOutputCoinStrs);
  let inputCoins = cachedInputCoins

  // console.log("Input coin cached: analyzeOutputCoinFromCached : ", inputCoins);

  // cache leftOutputCoinStrs
  if (uncachedOutputCoinStrs.length > 0) {
    let uncachedInputCoins = parseInputCoinFromEncodedObject(uncachedOutputCoinStrs, account.key, account.derivatorPointCached);
    account.mergeDerivatorCached();
    account.mergeInputCoinJsonCached(uncachedOutputCoinStrs, uncachedInputCoins);
    inputCoins = inputCoins.concat(uncachedInputCoins);
    allOutputCoinStrs = cachedOutputCoinStrs.concat(uncachedOutputCoinStrs);
  }

  // get unspent coin from cache
  let { unspentInputCoinsFromCached, unspentInputCoinsFromCachedStrs } = account.analyzeSpentCoinFromCached(inputCoins, allOutputCoinStrs);

  let { unspentCoins, unspentCoinStrs } = await getUnspentCoin(unspentInputCoinsFromCached, paymentAddrSerialize, unspentInputCoinsFromCachedStrs, null, rpcClient);

  // get list of spending coins, which in tx in membool
  let { UTXOExceptSpeningCoin, UTXOExceptSpeningCoinStrs } = getUTXOsExceptSpendingCoin(unspentCoins, unspentCoinStrs, account);
  // console.log("UTXOExceptSpeningCoin: ", UTXOExceptSpeningCoin);

  // get UTXO less than amount
  let defragmentUTXO = [];
  let defragmentUTXOStr = [];
  let totalAmount = new bn(0);
  let numUTXO = 0;

  for (let i = 0; i < UTXOExceptSpeningCoin.length; i++) {
    if (UTXOExceptSpeningCoin[i].coinDetails.value.cmp(amount) != 1) {
      defragmentUTXO.push(UTXOExceptSpeningCoin[i]);
      defragmentUTXOStr.push(UTXOExceptSpeningCoinStrs[i]);
      totalAmount = totalAmount.add(UTXOExceptSpeningCoin[i].coinDetails.value);
      numUTXO++;
      if (numUTXO >= MaxInputNumberForDefragment) {
        break;
      }
    }
  }
  console.log("defragmentUTXO: ", defragmentUTXO.length)
  console.log("Get unspent input coin less than amount done!");

  totalAmount = totalAmount.sub(fee);

  if (totalAmount.cmp(new bn(0)) == -1) {
    console.log("You shouldn't defragment wallet now beacause the number of UTXO need to be defragmented is so small!!! ")
    throw new Error("the number of UTXO need to be defragmented is so small");
  }

  console.log("Get UTXO done!");

  return {
    defragmentUTXO: defragmentUTXO,
    defragmentUTXOStr: defragmentUTXOStr,
    totalAmount: totalAmount,
  };
};

const getUTXOsExceptSpendingCoin = (unspentCoins, unspentCoinStrs, account) => {
  if (account.spendingCoins){
    if (account.spendingCoins.length) {
      let UTXOExceptSpeningCoin = cloneInputCoinArray(unspentCoins);
      let UTXOExceptSpeningCoinStrs = unspentCoinStrs;

      for (let i = 0; i < account.spendingCoins.length; i++) {
        for (let j = 0; j < account.spendingCoins[i].spendingSNs.length; j++) {
          // console.log("Spending coin : ", account.spendingCoins)
          for (let k = 0; k < UTXOExceptSpeningCoin.length; k++) {
            if (account.spendingCoins[i].spendingSNs[j].toString() === UTXOExceptSpeningCoin[k].coinDetails.serialNumber.compress().toString()) {
              UTXOExceptSpeningCoin.splice(k, 1);
              UTXOExceptSpeningCoinStrs.splice(k, 1);
            }
          }
        }
      }
      // console.log("UTXOExceptSpeningCoin getUnspentCoinExceptSpendingCoin after : ", UTXOExceptSpeningCoin);
      return {
        UTXOExceptSpeningCoin: UTXOExceptSpeningCoin,
        UTXOExceptSpeningCoinStrs: UTXOExceptSpeningCoinStrs
      }
    }
  } 

  return {
    UTXOExceptSpeningCoin: unspentCoins,
    UTXOExceptSpeningCoinStrs: unspentCoinStrs
  }
};

const getUnspentCoinExceptSpendingCoin = (unspentCoins, account) => {
  // console.log("unspentCoinExceptSpeningCoin getUnspentCoinExceptSpendingCoin before: ", unspentCoinExceptSpeningCoin);
  // console.log(" AAAA account.spendingCoins: ", account.spendingCoins);

  if (account.spendingCoins){
    if (account.spendingCoins.length){
      let unspentCoinExceptSpendingCoin = cloneInputCoinArray(unspentCoins);
      for (let i = 0; i < account.spendingCoins.length; i++) {
        for (let j = 0; j < account.spendingCoins[i].spendingSNs.length; j++) {
          for (let k = 0; k < unspentCoinExceptSpendingCoin.length; k++) {
            // console.log("FFF account.spendingCoins[i].spendingCoins[j].toString(): ", account.spendingCoins[i].spendingSNs[j].toString());
            // console.log("FFF unspentCoinExceptSpeningCoin[k].coinDetails.serialNumber.compress().toString(): ", unspentCoinExceptSpeningCoin[k].coinDetails.serialNumber.compress().toString());
            if (account.spendingCoins[i].spendingSNs[j].toString() === unspentCoinExceptSpendingCoin[k].coinDetails.serialNumber.compress().toString()) {
              unspentCoinExceptSpendingCoin.splice(k, 1);
            }
          }
        }
      }
      console.log("unspentCoinExceptSpeningCoin getUnspentCoinExceptSpendingCoin after : ", unspentCoinExceptSpendingCoin);
      return unspentCoinExceptSpendingCoin;
    } 
  }

  return unspentCoins;
}


// getUnspentCoin returns unspent coins
const getUnspentCoin = async (inputCoins, paymentAddrSerialize, inCoinStrs, tokenID, rpcClient) => {
  console.time("Getunspent coin:")
  let unspentCoins = new Array();
  let unspentCoinStrs = new Array();

  let serialNumberStrs = new Array(inputCoins.length);

  for (let i = 0; i < inputCoins.length; i++) {
    serialNumberStrs[i] = checkEncode(inputCoins[i].coinDetails.serialNumber.compress(), ENCODE_VERSION);
  }

  // check whether each input coin is spent or not
  let response;
  try{
    response = await rpcClient.hasSerialNumber(paymentAddrSerialize, serialNumberStrs, tokenID);
  } catch(e){
    throw e;
  }

  let existed = response.existed;
  if (existed.length != inputCoins.length) {
    throw new Error("Wrong response when check has serial number");
  }

  for (let i = 0; i < existed.length; i++) {
    if (!existed[i]) {
      unspentCoins.push(inputCoins[i]);
      unspentCoinStrs.push(inCoinStrs[i]);
    }
  }
  // console.log("unspent input coin: ", unspentCoin);
  // console.log("unspent input coin len : ", unspentCoin.length);
  console.timeEnd("Getunspent coin:")
  return {
    unspentCoins: unspentCoins,
    unspentCoinStrs: unspentCoinStrs
  };
};

// getUnspentPrivacyCustomToken returns unspent privacy custom token
const getUnspentPrivacyCustomToken = async (inputCoins, paymentAddrSerialize, inCoinStrs, tokenID = null, rpcClient) => {
  let unspentCoin = new Array();
  let unspentCoinStrs = new Array();

  let serialNumberStrs = new Array(inputCoins.length);

  for (let i = 0; i < inputCoins.length; i++) {
    serialNumberStrs[i] = checkEncode(inputCoins[i].coinDetails.serialNumber.compress(), ENCODE_VERSION);
  }

  // check whether each input coin is spent or not
  let response;
  try{
    response = await rpcClient.hasSerialNumber(paymentAddrSerialize, serialNumberStrs, tokenID);
  } catch(e){
    throw e;
  }

  let existed = response.existed;

  for (let i = 0; i < existed.length; i++) {
    if (!existed[i]) {
      unspentCoin.push(inputCoins[i]);
      unspentCoinStrs.push(inCoinStrs[i]);
    }
  }
  // console.log("unspent input coin: ", unspentCoin);
  // console.log("unspent input coin len : ", unspentCoin.length);
  return {
    unspentCoin: unspentCoin,
    unspentCoinStrs: unspentCoinStrs
  };
};


export { 
  prepareInputForTx,
  prepareInputForCustomTokenTx,
  prepareInputForTxCustomTokenPrivacy,
  parseInputCoinFromEncodedObject,
  parseInputCoinToEncodedObject,
  chooseBestCoinToSpent,
  cloneInputCoinArray,
  estimateFee,
  getEstimateFee,
  getEstimateFeeForSendingToken,
  getEstimateFeeToDefragment,
  estimateTxSize,
  getUTXOsToDefragment,
  getUTXOsExceptSpendingCoin,
  getUnspentCoinExceptSpendingCoin,
  getUnspentCoin,
  getUnspentPrivacyCustomToken,
 };