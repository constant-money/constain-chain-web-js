// import {
//     KeyWallet as keyWallet
// } from "../../lib/core/hdwallet";
import {
    Wallet,
} from "../../lib/wallet";
import {
    RpcClient
} from "../../lib/rpcclient/rpcclient";
import {
    CustomTokenInit,
    CustomTokenTransfer
} from "../../lib/tx/constants";
import {
    PaymentAddressType,
    PRVIDSTR,
    base58CheckDeserialize,
    KeyWallet
} from "../../lib/core";
import {
    ENCODE_VERSION
} from "../../lib/common/constants";
import {
    checkEncode
} from "../../lib/common/base58";

// const rpcClient = new RpcClient("https://mainnet.incognito.org/fullnode");
// const rpcClient = new RpcClient("https://testnet.incognito.org/fullnode");
// const rpcClient = new RpcClient("http://localhost:9334");
// const rpcClient = new RpcClient("https://dev-test-node.incognito.org");
// const rpcClient = new RpcClient("http://139.162.55.124:8334");   // dev-net

let wallet;
let senderPrivateKeyStr;
let senderKeyWallet;
let accountSender;
let senderPaymentAddressStr;
let receiverPaymentAddrStr;
let receiverPaymentAddrStr2;

async function setup(){
    // await sleep(10000);
    wallet = new Wallet();
    await wallet.setProvider("http://139.162.55.124:8334");
    senderPrivateKeyStr = "112t8rnZDRztVgPjbYQiXS7mJgaTzn66NvHD7Vus2SrhSAY611AzADsPFzKjKQCKWTgbkgYrCPo9atvSMoCf9KT23Sc7Js9RKhzbNJkxpJU6";
    // senderKeyWallet = base58CheckDeserialize(senderPrivateKeyStr);
    // await senderKeyWallet.KeySet.importFromPrivateKey(senderKeyWallet.KeySet.PrivateKey);
    // accountSender.key = senderKeyWallet;

    accountSender = await wallet.NewTransactor(senderPrivateKeyStr);
    senderPaymentAddressStr = accountSender.key.base58CheckSerialize(PaymentAddressType);
    accountSender.isSubmitOtaKey = true;
    receiverPaymentAddrStr = "12shR6fDe7ZcprYn6rjLwiLcL7oJRiek66ozzYu3B3rBxYXkqJeZYj6ZWeYy4qR4UHgaztdGYQ9TgHEueRXN7VExNRGB5t4auo3jTgXVBiLJmnTL5LzqmTXezhwmQvyrRjCbED5xVWf4ETHbRCSP";
    receiverPaymentAddrStr2 = "12sm28usKxzw8HuwGiEojZZLWgvDinAkmZ3NvBNRQLuPrf5LXNLXVXiu4VBCMVDrDm97qjLrgFck3P36UTSWfqNX1PBP9PBD78Cpa95em8vcnjQrnwDNi8EdkdkSA6CWcs4oFatQYze7ETHAUBKH";
}
async function TestGetBalance() {

    await setup();
    // create and send PRV
    try {
        let balance = await accountSender.getBalance(null);
        console.log("balance: ", balance);
    } catch (e) {
        console.log("Error when get balance: ", e);
    }
}
async function TestGetAllPrivacyTokenBalance() {

    await setup();
    // create and send PRV
    try {
        let result = await accountSender.getAllPrivacyTokenBalance();
        console.log("result: ", result);
    } catch (e) {
        console.log("Error when get balance: ", e);
    }
}
async function TestGetRewardAmount() {

    await setup();
    // get reward amount
    let response0;
    try {
        response0 = await accountSender.getRewardAmount(false, "");
    } catch (e) {
        console.log(e);
    }
    console.log("Response getRewardAmount: ", response0);
}
async function TestCreateAndSendRewardAmountTx() {

    await setup();

    let fee = 10;
    let response;
    try {
        response = await accountSender.createAndSendWithdrawRewardTx(fee, null);
        console.log("Response createAndSendWithdrawRewardTx: ", response);
        return response.Response.txId;
    } catch (e) {
        console.log(e);
        throw e;
    }
}
async function TestBurningRequestTx() {

    await setup();

    let fee = 20;
    // create and send burning request tx
    let response;
    try {
        response = await accountSender.createAndSendBurningRequestTx([], fee, tokenID, "d5808Ba261c91d640a2D4149E8cdb3fD4512efe4", 100);
        console.log("Response createAndSendBurningRequestTx: ", response);
        return response.Response.txId;
    } catch (e) {
        // this tx specifically depends on bridge config, so we let it skip and review manually
        console.error(e);
        // throw e;
    }
}
async function TestStakerStatus() {

    // sender key
    await setup();

    // get staker status
    let response0;
    try {
        response0 = await accountSender.stakerStatus();
    } catch (e) {
        console.log(e);
    }

    console.log("Response status staker: ", response0);
}
async function TestCreateAndSendNativeToken() {

    await setup();
    let fee = 10;
    let info = "INFOFO";
    let amountTransfer = 1000000000; // in nano PRV
    console.log("Will Transfer: ", amountTransfer);

    let paymentInfosParam = [];
    paymentInfosParam[0] = {
        "PaymentAddress": senderPaymentAddressStr,
        "Amount": amountTransfer,
        "Message": ""
    };

    // create and send PRV
    try {
        let res = await accountSender.createAndSendNativeToken(paymentInfosParam, fee, info, true);
        console.log('Send tx succesfully with TxID: ', res.Response.txId);
        return res.Response.txId;
    } catch (e) {
        console.log("Error when send PRV: ", e);
        throw e;
    }
}
async function TestSendMultiple() {
    await setup();

    let info = "";

    const receivers = [
        '12shR6fDe7ZcprYn6rjLwiLcL7oJRiek66ozzYu3B3rBxYXkqJeZYj6ZWeYy4qR4UHgaztdGYQ9TgHEueRXN7VExNRGB5t4auo3jTgXVBiLJmnTL5LzqmTXezhwmQvyrRjCbED5xVWf4ETHbRCSP',
        '12sm28usKxzw8HuwGiEojZZLWgvDinAkmZ3NvBNRQLuPrf5LXNLXVXiu4VBCMVDrDm97qjLrgFck3P36UTSWfqNX1PBP9PBD78Cpa95em8vcnjQrnwDNi8EdkdkSA6CWcs4oFatQYze7ETHAUBKH',
    ];
    const amount = 1*1e9;
    const paymentInfos = receivers.map(item => ({
        "PaymentAddress": item,
        "Amount": amount,
    }));
    try{
        const res = await accountSender.createAndSendNativeToken(paymentInfos, 100, info, false);
        console.log('Send tx succesfully with TxID: ', res.Response.txId);
        return res.Response.txId;
    }catch(e){
        console.log("error:",e);
        throw e;
    }
}
async function TestCreateAndSendConversion() {

    await setup();
    let fee = 100;
    let info = "";
    console.log("Will convert all PRV");

    let paymentInfosParam = [];

    // create and send PRV
    try {
        let res = await accountSender.createAndSendConvertTx(paymentInfosParam, fee, info, false);
        console.log('Send tx succesfully with TxID: ', res.Response.txId);
        return res.Response.txId;
    } catch (e) {
        console.log("Error when send PRV: ", e);
        throw e;
    }
}
async function TestCreateAndSendTokenConversion() {

    await setup();
    let fee = 100;
    let info = "";
    // use the global var tokenID instead
    // let tokenID = "89eddbfac0e6c4827f378c4c453c9011c2b78e50cc54479d70914c505946d526";
    console.log("Will convert all coins of token", tokenID);

    // PRV for fee, token for convert. So no payment info needed
    let paymentInfo = [];
    let tokenPaymentInfo = [];

    // create and send PRV
    try {
        let res = await accountSender.createAndSendTokenConvertTx(tokenID, paymentInfo, tokenPaymentInfo, fee, info, false);
        console.log('Send tx succesfully with TxID: ', res.Response.txId);
        return res.Response.txId;
    } catch (e) {
        console.log("Error when send PRV: ", e);
        throw e;
    }
}
async function TestCreateAndSendPrivacyTokenInit() {

    await setup();
    // payment info for PRV
    let paymentInfos = [];
    // prepare token param for tx privacy token init
    let amountInit = 10000;
    let tokenParams = {
        TokenID: "",
        TokenName: "Rose1",
        TokenSymbol: "RSE",
        TokenTxType: CustomTokenInit,
        Amount: amountInit
    }
    let tokenPaymentInfo = [{
            PaymentAddress: senderPaymentAddressStr,
            Amount: amountInit,
            Message: "Your token",
    }]

    let feePRV = 50;

    try {
        let res = await accountSender.createAndSendPrivacyToken("", paymentInfos, tokenPaymentInfo, feePRV, "", false, false, tokenParams);
        console.log('Send tx succesfully with TxID: ', res.Response.txId);
        return {
            tokenID: res.TokenID,
            Response: res.Response
        }
    } catch (e) {
        console.log("Error when initing ptoken: ", e);
        throw e;
    }
}
async function TestCreateAndSendPrivacyTokenTransfer() {
    await setup();

    let paymentInfos = [];
    let amountTransfer = 44;

    // prepare token param for tx custom token init
    let tokenPaymentInfo = [{
            PaymentAddress: receiverPaymentAddrStr,
            Amount: amountTransfer,
            Message: "Transfer ptoken"
    }]

    let feePRV = 10;
    let hasPrivacy = true;

    try{
        let res = await accountSender.createAndSendPrivacyToken(tokenID, paymentInfos, tokenPaymentInfo, feePRV, hasPrivacy, "");
        console.log('Send tx succesfully with TxID: ', res.Response.txId);
        return res.Response.txId;
    }catch (e) {
        console.log("Error when transferring ptoken: ", e);
        throw e;
    }
}

async function TestMultipleSendPrivacyToken() {

    await setup();

    let paymentInfos = [];
    let amountTransfer = 100;

    // prepare token param for tx custom token init
    let tokenPaymentInfo = [{
            PaymentAddress: receiverPaymentAddrStr,
            Amount: amountTransfer,
            Message: "Transfer ptoken"
    },
    {
            PaymentAddress: receiverPaymentAddrStr2,
            Amount: amountTransfer,
            Message: "Transfer ptoken 2"
    }]

    let feePRV = 10;

    try{
        let res = await accountSender.createAndSendPrivacyToken(tokenID, paymentInfos, tokenPaymentInfo, feePRV, "");
        console.log('Send tx succesfully with TxID: ', res.Response.txId);
        return res.Response.txId;
    }catch (e) {
        console.log("Error when transferring ptoken: ", e);
        throw e;
    }
}
async function TestCreateAndSendStakingTx() {

    await setup();

    let param = {
        type: 0
    };
    let fee = 30;
    let candidatePaymentAddress = senderPaymentAddressStr;
    // let candidateMiningSeedKey = "12VH5z8JCn9B8SyHvB3aYP4ZGr1Wf9Rywx2ZSBe3eQneADzJ3bL";
    let rewardReceiverPaymentAddress = senderPaymentAddressStr;
    let autoReStaking = true;

    let candidateMiningSeedKey = checkEncode(accountSender.key.getMiningSeedKey(), ENCODE_VERSION);

    // create and send staking tx
    try {
        let response = await accountSender.createAndSendStakingTx(param, fee, candidatePaymentAddress, candidateMiningSeedKey, rewardReceiverPaymentAddress, autoReStaking);
        return response.Response.txId;
    } catch (e) {
        console.log("Error when staking: ", e);
        throw e;
    }
}
async function TestCreateAndSendStopAutoStakingTx() {

    await setup();
    let fee = 5;
    let candidatePaymentAddress = senderPaymentAddressStr;
    let candidateMiningSeedKey = checkEncode(accountSender.key.getMiningSeedKey(), ENCODE_VERSION);

    // create and send staking tx
    try {
        let response = await accountSender.createAndSendStopAutoStakingTx(fee, candidatePaymentAddress, candidateMiningSeedKey);
        return response.Response.txId;
    } catch (e) {
        console.log("Error when staking: ", e);
        throw e;
    }
}
async function TestDefragment() {
    await setup();
    // create and send defragment tx
    let response;
    try {
        response = await accountSender.defragmentNativeCoin(100, 30);
    } catch (e) {
        console.log(e);
        throw e;
    }

    console.log("Response defragment: ", response);
}
async function TestMakeFragments() {
    await setup();
    const senders = [
        '112t8rnZDRztVgPjbYQiXS7mJgaTzn66NvHD7Vus2SrhSAY611AzADsPFzKjKQCKWTgbkgYrCPo9atvSMoCf9KT23Sc7Js9RKhzbNJkxpJU6'
    ];

    let utxos = 0;
    // the address of our testing account; it will receive a lot of 'fragments'
    const receiver = '12sxXUjkMJZHz6diDB6yYnSjyYcDYiT5QygUYFsUbGUqK8PH8uhxf4LePiAE8UYoDcNkHAdJJtT1J6T8hcvpZoWLHAp8g6h1BQEfp4h5LQgEPuhMpnVMquvr1xXZZueLhTNCXc8fkVXseeVAGCt8';

    const amountTransfer = 200;
    let paymentInfos = new Array(30);
    paymentInfos.fill({
        "PaymentAddress": receiver,
        "Amount": amountTransfer,
    });

    while (utxos < 150) {
        for (const sender of senders) {
            let accountSender = await wallet.NewTransactor(sender);

            // create and send PRV
            let res = await accountSender.createAndSendNativeToken(paymentInfos, 100, "Fragment", false);
            console.log('Send tx succesfully with TxID: ', res.Response.txId);
            await accountSender.waitTx(res.Response.txId, 3);
        }

        utxos += paymentInfos.length * senders.length;
        console.log('NEW UTXOs', utxos);
    }
}
/************************* DEX **************************/
// 1:10 ratio
async function TestCreateAndSendPTokenContributionTx() {

    await setup();
    let fee = 15;
    let pdeContributionPairID = "123";
    let contributedAmount = 100;

    try {
        let response = await accountSender.createAndSendTxWithContribution(
            fee, pdeContributionPairID, contributedAmount, "", tokenID
        );
        return response.Response.txId;
    } catch (e) {
        console.log("Error when staking: ", e);
        throw e;
    }
}
async function TestCreateAndSendPRVContributionTx() {

    await setup();
    let fee = 15;
    let pdeContributionPairID = "123";
    let contributedAmount = 1000;

    try {
        let response = await accountSender.createAndSendTxWithContribution(
            fee, pdeContributionPairID, contributedAmount
        );
        return response.Response.txId;
    } catch (e) {
        console.log("Error when staking: ", e);
        throw e;
    }
}
async function TestCreateAndSendNativeTokenTradeRequestTx() {

    await setup();

    let fee = 100;
    let sellAmount = 100;
    let tokenIDToSellStr = null;
    let tokenIDToBuyStr = tokenID;
    let minAcceptableAmount = 100;
    let tradingFee = 25;

    // create and send staking tx
    try {
        let res = await accountSender.createAndSendNativeTokenTradeRequestTx(
            fee, tokenIDToBuyStr, sellAmount, minAcceptableAmount, tradingFee, "", tokenIDToSellStr
        );
        return res.Response.txId;
        console.log("RESPONSE: ", res);
    } catch (e) {
        console.log("Error when trading native token: ", e);
        throw e;
    }
}
async function TestCreateAndSendPTokenTradeRequestTx() {

    await setup();

    let feePRV = 10;
    let sellAmount = 300;
    let tokenIDToSellStr = tokenID;
    let tokenIDToBuyStr = null;
    let minAcceptableAmount = 600;
    let tradingFee = 10;


    // create and send staking tx
    try {
        let res = await accountSender.createAndSendNativeTokenTradeRequestTx(
            feePRV, tokenIDToBuyStr, sellAmount, minAcceptableAmount, tradingFee, "", tokenIDToSellStr
        );
        return res.Response.txId;
        console.log("RESPONSE: ", res);
    } catch (e) {
        console.log("Error when trading native token: ", e);
        throw e;
    }
}

async function TestCustomContribution(pdeContributionPairID, contributingTokenID, contributedAmount) {
    await setup();
    let fee = 50;
    // let pdeContributionPairID = "123";
    // let contributedAmount = 1000000;

    try {
        let response = await accountSender.createAndSendTxWithContribution(
            fee, pdeContributionPairID, contributedAmount, "", contributingTokenID
        );
        return response.Response.txId;
    } catch (e) {
        console.log("Error when staking: ", e);
        throw e;
    }
}
async function TestCustomTradeRequest(tokenIDToSellStr, tokenIDToBuyStr, sellAmount, minAcceptableAmount) {
    await setup();

    let feePRV = 50;
    // let sellAmount = 300;
    // let tokenIDToSellStr = tokenID;
    // let tokenIDToBuyStr = null;
    // let minAcceptableAmount = 2900;
    let tradingFee = 50;

    // create and send staking tx
    try {
        let res = await accountSender.createAndSendNativeTokenTradeRequestTx(
            feePRV, tokenIDToBuyStr, sellAmount, minAcceptableAmount, tradingFee, "", tokenIDToSellStr
        );
        return res.Response.txId;
        console.log("RESPONSE: ", res);
    } catch (e) {
        console.log("Error when trading native token: ", e);
        throw e;
    }
}

async function TestCreateAndSendPDEWithdrawTx() {
    await setup();
    let fee = 10;
    let withdrawShareAmount = 500;
    let tokenID1 = null;
    let tokenID2 = tokenID;

    try {
        let res = await accountSender.createAndSendWithdrawDexTx(
            fee, tokenID1, tokenID2, withdrawShareAmount
        );
        return res.Response.txId;
        console.log("res: ", res);
    } catch (e) {
        console.log("Error when withdrawing pdex: ", e);
        throw e;
    }
}
async function TestGetOutputCoins() {
    await setup();
    // accountSender.setIsRevealViewKeyToGetCoins(true);
    let allCoins = await accountSender.fetchOutputCoins(null, wallet.RpcClient, -1);
    console.log("allCoins: ", allCoins);
}

async function GetListReceivedTx() {
    await setup();
    try{
        let receivedTxs = await accountSender.getReceivedTransaction();
        console.log(receivedTxs);
    }catch(e){
        throw e;
    }
}

// to run this test flow, make sure the account has enough PRV to stake & some 10000 of this token; both are version 1
var tokenID = "699a3006d1865ebdc437053b33df6a62c6c7c2f554f2fd0adf99a60f5117f945";
var secondTokenID = "46107357c32ffbb04d063cf8a08749cba83546a67e299fb9ffcc2a9955df4736";
// var tokenID = "084bf6ea0ad2e54a04a8e78c15081376dbdfc2ef2ce6d151ebe16dc59eae4a47";
async function MainRoutine(){
    console.log("BEGIN WEB WALLET TEST");
    // sequential execution of tests; the wait might still be too short
    try{
        let txh;
        await TestGetBalance();
        await TestGetAllPrivacyTokenBalance();
        txh = await TestCreateAndSendConversion();
        await accountSender.waitTx(txh, 5);
        txh = await TestCreateAndSendNativeToken();
        await accountSender.waitTx(txh, 5);

        txh = await TestCreateAndSendStakingTx();
        await accountSender.waitTx(txh, 5);

        await GetListReceivedTx();
        await TestStakerStatus();
        txh = await TestCreateAndSendTokenConversion();
        await accountSender.waitTx(txh, 5);
        // init token may err when a token of that name already exists
        let temp = await TestCreateAndSendPrivacyTokenInit();
        await accountSender.waitTx(temp.Response.txId, 5);
        txh = await TestSendMultiple();
        await accountSender.waitTx(txh, 5);
     // burning will return an error since this is not a bridge token
        txh = await TestBurningRequestTx();
        if (txh){
            await accountSender.waitTx(txh, 5);
        }
        txh = await TestCreateAndSendPrivacyTokenTransfer();
        await accountSender.waitTx(txh, 5);

        tokenID = temp.tokenID;
        console.log("New token", temp.tokenID);
        txh = await TestCreateAndSendPrivacyTokenTransfer();
        await accountSender.waitTx(txh, 5);
        await TestGetOutputCoins();

        txh = await TestCreateAndSendStopAutoStakingTx();
        await accountSender.waitTx(txh, 5);
    }catch(e){
        console.log("Test failed");
        console.error(e);
        throw e;
    }
    console.log("END WEB WALLET TEST");
}
// MainRoutine();

// // to run this test flow, make sure the account has about 2.5mil PRV, 120k of each of FIRST and SECOND token; all version 2
// async function PDERoutine(){
//     console.log("BEGIN PDE TEST");
//     try{
//         let txh;
//         // // 10:1 ratio; contribute 1mil PRV and 100k token
//         txh = await TestCustomContribution("first-prv", null, 1000000);
//         // console.debug(txh);
//         await accountSender.waitTx(txh, 5);
//         txh = await TestCustomContribution("first-prv", tokenID, 100000);
//         await accountSender.waitTx(txh, 5);
//         // sell 10000 PRV for at least 800 token
//         txh = await TestCustomTradeRequest(null, tokenID, 10000, 800);
//         await accountSender.waitTx(txh, 5);
//         // sell 1000 token for at least 8000 PRV
//         txh = await TestCustomTradeRequest(tokenID, null, 1000, 8000);
//         // the final wait time is extended to accomodate beacon response delay
//         await accountSender.waitTx(txh, 15);
//
//         // to cross trade, we need the above pair and a new second-prv pair
//         // also 10:1 ratio
//         txh = await TestCustomContribution("second-prv", null, 1000000);
//         await accountSender.waitTx(txh, 5);
//         txh = await TestCustomContribution("second-prv", secondTokenID, 100000);
//         await accountSender.waitTx(txh, 5);
//         // sell 15000 FIRST for at least 14000 SECOND
//         txh = await TestCustomTradeRequest(tokenID, secondTokenID, 15000, 10000);
//         await accountSender.waitTx(txh, 5);
//         // sell 5000 SECOND for at least 4000 PRV
//         txh = await TestCustomTradeRequest(secondTokenID, tokenID, 5000, 3000);
//         await accountSender.waitTx(txh, 15);
//         // deprecated test flows
//         // await TestCreateAndSendPRVContributionTx();
//         // await wallet.sleep(10000);
//         // await TestCreateAndSendPTokenContributionTx();
//         // await wallet.sleep(30000);
//         // console.log("TRADE");
//         // await TestCreateAndSendNativeTokenTradeRequestTx();
//         // await wallet.sleep(30000);
//         // await TestCreateAndSendPTokenTradeRequestTx();
//         // await wallet.sleep(100000);
//         // await TestCreateAndSendPDEWithdrawTx();
//         // await wallet.sleep(100000);
//         console.log("Remember to check the balance of these accounts")
//     }catch(e){
//         console.log("Test failed");
//         console.error(e);
//         throw e;
//     }
//     console.log("END PDE TEST");
// }
// PDERoutine();

// to use this test flow, make sure acc1 has some 10000s in PRV in version 2 coins
async function DefragmentRoutine(){
    console.log("BEGIN DEFRAG TEST");
    try{
        await TestMakeFragments();
        // await wallet.sleep(20000);
        await TestDefragment();
    }catch(e){
        console.log("Test failed");
        console.error(e);
        throw e;
    }
    console.log("END DEFRAG TEST");
}
// DefragmentRoutine()

setup();
TestCreateAndSendNativeToken();
