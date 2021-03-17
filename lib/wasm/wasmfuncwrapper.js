import { Wallet } from "../wallet/wallet";

const requiredTimeFuncName = [
  'initPrivacyTx',
  'stopAutoStaking',
  'staking',
  'initPrivacyTokenTx',
  'initBurningRequestTx',
  'initWithdrawRewardTx',
  'initPRVContributionTx',
  'initPTokenContributionTx',
  'initPRVTradeTx',
  'initPTokenTradeTx',
  'withdrawDexTx',
  'initIssuingETHReqTx',
];

const asyncFuncName = [
  'generateBLSKeyPairFromSeed',
  'deriveSerialNumber',
  'randomScalars',
  'hybridEncryptionASM',
  'hybridDecryptionASM',
  'generateKeyFromSeed',
  'scalarMultBase',
  'parseNativeRawTx',
  'parsePrivacyTokenRawTx',
];

async function getNodeTime() {
    return Wallet.RpcClient.getNodeTime();
}

function getGlobalFunc(funcName) {
    if (typeof window !== 'undefined' && typeof window[funcName] === 'function') {
        // browser
        return window[funcName];
    } else if (typeof global !== 'undefined' && typeof global[funcName] === 'function') {
        // node, react native
        return global[funcName];
    }

    throw new Error(`Can not found global function ${funcName}`);
}

function createWrapperAsyncFunc(funcName) {
    const globalFunc = getGlobalFunc(funcName);

    return async function(data) {
        return globalFunc(data);
    };
}

function createWrapperRequiredTimeFunc(funcName) {
    const globalFunc = getGlobalFunc(funcName);

    return async function(data) {
        const time = await getNodeTime();
        return globalFunc(data, time);
    }
}

function getWrapperFunc(funcName) {
    let func;
    if (requiredTimeFuncName.includes(funcName)) {
        func = createWrapperRequiredTimeFunc(funcName);
    } else if (asyncFuncName.includes(funcName)) {
        func = createWrapperAsyncFunc(funcName);
        console.log("Func from async: ", func);
    }

    if (typeof func === 'function') {
        wasmFuncs[funcName] = func;
        return func;
    } else {
        console.log(`Not found wasm function name ${funcName}`);
        throw new Error("Invalid wasm function name");
    }
}

const wasmFuncs = new Proxy({
    deriveSerialNumber: null,
    initPrivacyTx: null,
    randomScalars: null,
    staking: null,
    stopAutoStaking: null,
    initPrivacyTokenTx: null,
    withdrawDexTx: null,
    initPTokenTradeTx: null,
    initPRVTradeTx: null,
    initPTokenContributionTx: null,
    initPRVContributionTx: null,
    initWithdrawRewardTx: null,
    initBurningRequestTx: null,
    generateKeyFromSeed: null,
    scalarMultBase: null,
    hybridEncryptionASM: null,
    hybridDecryptionASM: null,
    generateBLSKeyPairFromSeed: null,
    parseNativeRawTx: null,
    parsePrivacyTokenRawTx: null,
    initIssuingETHReqTx: null,
  }, {
    get: function(obj, prop) {
        if ([...requiredTimeFuncName, ...asyncFuncName].includes(prop)) {
            return obj[prop] || getWrapperFunc(prop);
        }

        return obj[prop];
    },
    set: function(obj, prop, value) {
      if (typeof value === 'function') {
        obj[prop] = value;
      } else {
        throw new Error(`${prop} must be a function`);
      }

      return true;
    }
  });


export default wasmFuncs;
