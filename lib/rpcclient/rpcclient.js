import { RPCHttpService } from './rpchttpservice';
import { checkDecode, checkEncode } from "../common/base58";
import { stringToBytes, bytesToString } from '../privacy/utils';
import { ENCODE_VERSION } from "../common/constants";
import { CustomError, ErrorObject, RPCError } from '../common/errorhandler';
import { PRVIDSTR, PDEPOOLKEY } from "../core/constants";

const parseResponse = async (rpcService, method, params = []) => {
  const data = {
    "jsonrpc": "1.0",
    "method": method,
    "params": params,
    "id": 1
  };
  let response;
  try {
    response = await rpcService.postRequest(data);
  } catch (e) {
    throw e;
  }

  if (response.status !== 200) {
    throw new Error("Can't request API " + data.method);
  } else if (response.data.Error) {
    throw new RPCError(method, response.data.Error);
  }

  return response.data.Result;
};

class RpcClient {
    constructor(url, user, password) {
        this.rpcHttpService = new RPCHttpService(url, user, password)
    }

    async getOutputCoin (paymentAdrr, viewingKey = "", otaKey, tokenID = null, toHeight = 0, submitted = true) {
        let data = {
            "jsonrpc": "1.0",
            "method": submitted? "listoutputcoinsfromcache" : "listoutputcoins",
            "params": [
                0,
                0,
                [{
                    "PaymentAddress": paymentAdrr,
                    "ReadonlyKey": viewingKey,
                    "OTASecretKey": otaKey,
                    "StartHeight": toHeight
                }],
            ],
            "id": 1
        };

        if (tokenID != null) {
            data["params"][3] = tokenID;
        }
        // console.debug("REQ DATA: ", JSON.stringify(data));
        let response;
        try {
            response = await this.rpcHttpService.postRequest(data);
        } catch (e) {
            throw e;
        }
        // console.log("response is", response)
        if (response.status !== 200) {
            throw new Error("Can't request API get all output coins");
        } else if (response.data.Error) {
            throw response.data.Error;
        }
        // console.log(response.data.Result.Outputs)
        let outCoinsMap = response.data.Result.Outputs;
        let outCoins = [];
        for (let key in outCoinsMap){
            if (key == paymentAdrr || (viewingKey !== "" && key == viewingKey)){
                outCoins = outCoinsMap[key];
                break;
            }
        }

        return {
            outCoins: outCoins,
            next: response.data.Result.FromHeight
        }
    };

    async getOutputCoinFromCache (paymentAdrr, viewingKey = "", otaKey, tokenID = null) {
        let data = {
            "jsonrpc": "1.0",
            "method": "listoutputcoinsfromcache",
            "params": [
                0,
                999999,
                [{
                    "PaymentAddress": paymentAdrr,
                    "ReadonlyKey": viewingKey,
                    "OTASecretKey": otaKey,
                    "StartHeight": 0
                }],
            ],
            "id": 1
        };

        if (tokenID != null) {
            data["params"][3] = tokenID;
        }
        let response;
        try {
            response = await this.rpcHttpService.postRequest(data);
        } catch (e) {
            throw e;
        }

        if (response.status !== 200) {
            throw new Error("Can't request API get all output coins");
        } else if (response.data.Error) {
            throw response.data.Error;
        }

        let outCoinsMap = response.data.Result.Outputs;
        let outCoins;
        for (let key in outCoinsMap){
            if (key == paymentAdrr || (viewingKey !== "" && key == viewingKey)){
                outCoins = outCoinsMap[key];
                break;
            }
        }

        return {
            outCoins: outCoins
        }
    };

    // hasSerialNumber return true if serial number existed in database
    async hasSerialNumber (paymentAddr, serialNumberStrs, tokenID = null) {
        const data = {
            "jsonrpc": "1.0",
            "method": "hasserialnumbers",
            "params": [
                paymentAddr,
                serialNumberStrs,
            ],
            "id": 1
        };

        if (tokenID != null) {
            data["params"][2] = tokenID;
        }

        let response;
        try {
            response = await this.rpcHttpService.postRequest(data);
        } catch (e) {
            throw e;
        }

        if (response.status !== 200) {
            throw new Error("Can't request API check has serial number");
        } else if (response.data.Error) {
            throw response.data.Error;
        }

        return {
            existed: response.data.Result
        }
    };

    // hasSNDerivator return true if snd existed in database
    async hasSNDerivator (paymentAddr, snds, tokenID = null) {
        const data = {
            "jsonrpc": "1.0",
            "method": "hassnderivators",
            "params": [
                paymentAddr,
                snds,
            ],
            "id": 1
        };

        if (tokenID != null) {
            data["params"][2] = tokenID;
        }

        let response;
        try {
            response = await this.rpcHttpService.postRequest(data);
        } catch (e) {
            throw e;
        }

        if (response.status !== 200) {
            throw new Error("Can't request API check has serial number derivator");
        } else if (response.data.Error) {
            throw response.data.Error;
        }

        return {
            existed: response.data.Result,
        }
    };

    // randomCommitmentsProcess randoms list commitment for proving
    async randomCommitmentsProcess (paymentAddr, inputCoinStrs, tokenID = null) {
        const data = {
            "jsonrpc": "1.0",
            "method": "randomcommitments",
            "params": [
                paymentAddr,
                inputCoinStrs,
            ],
            "id": 1
        };

        if (tokenID != null) {
            data["params"][2] = tokenID;
        }

        let response;
        try {
            response = await this.rpcHttpService.postRequest(data);
            //
        } catch (e) {
            throw e;
        }

        if (response.status !== 200) {
            throw new Error("Can't request API random commitments");
        } else if (response.data.Error) {
            throw response.data.Error;
        }

        let commitmentStrs = response.data.Result.Commitments;

        // // deserialize commitments
        // let commitments = new Array(commitmentStrs.length);
        // for (let i = 0; i < commitments.length; i++) {
        //   let res = checkDecode(commitmentStrs[i]);

        //   if (res.version !== ENCODE_VERSION) {
        //     throw new Error("Base58 check decode wrong version");
        //   }

        //   commitments[i] = P256.decompress(res.bytesDecoded);
        // }

        return {
            commitmentIndices: response.data.Result.CommitmentIndices,
            commitmentStrs: commitmentStrs,
            myCommitmentIndices: response.data.Result.MyCommitmentIndexs,
        }
    };

    async getOtherCoinsForRing (paymentAddr, numOfCoinsToGet, tokenID = null) {
        const data = {
            "jsonrpc": "1.0",
            "method": "randomcommitmentsandpublickeys",
            "params": [
                paymentAddr,
                numOfCoinsToGet,
            ],
            "id": 1
        };

        if (tokenID != null) {
            data["params"][2] = tokenID;
        }

        let response;
        try {
            response = await this.rpcHttpService.postRequest(data);
            //
        } catch (e) {
            throw e;
        }

        if (response.status !== 200) {
            throw new Error("Can't request API random commitments");
        } else if (response.data.Error) {
            throw response.data.Error;
        }

        return {
            Indexes: response.data.Result.CommitmentIndices,
            Commitments: response.data.Result.Commitments,
            PublicKeys: response.data.Result.PublicKeys,
            AssetTags: response.data.Result.AssetTags
        }
    };

    async sendRawTx (serializedTxJson) {
        const data = {
            "jsonrpc": "1.0",
            "method": "sendtransaction",
            "params": [
                serializedTxJson,
            ],
            "id": 1
        };

        let response;
        try {
            response = await this.rpcHttpService.postRequest(data);
        } catch (e) {
            throw e;
        }

        if (response.status !== 200) {
            throw new Error("Can't request API send transaction");
        } else if (response.data.Error) {
            throw response.data.Error;
        }

        let res = response.data.Result;
        // for compatibility
        res.txId = res.TxID;
        return res;
    };

    // for tx custom token
    async sendRawTxCustomToken (tx) {

        const data = {
            "jsonrpc": "1.0",
            "method": "sendrawcustomtokentransaction",
            "params": [
                tx,
            ],
            "id": 1
        };

        let response;
        try {
            response = await this.rpcHttpService.postRequest(data);

        } catch (e) {
            throw e;
        }

        if (response.status !== 200) {
            throw new Error("Can't request API send custom token transaction");
        } else if (response.data.Error) {
            throw response.data.Error;
        }


        let res = response.data.Result;
        // for compatibility
        res.txId = res.TxID;
        return res;
    };

    // for tx custom token
    async sendRawTxCustomTokenPrivacy (serializedTxJson) {
        const data = {
            "jsonrpc": "1.0",
            "method": "sendrawprivacycustomtokentransaction",
            "params": [
                serializedTxJson,
            ],
            "id": 1
        };

        let response;
        try {
            response = await this.rpcHttpService.postRequest(data);
        } catch (e) {
            throw e;
        }

        if (response.status !== 200) {
            throw new Error("Can't request API send privacy custom token transaction");
        } else if (response.data.Error) {
            throw response.data.Error;
        }


        let res = response.data.Result;
        // for compatibility
        res.txId = res.TxID;
        return res;
    };

    async listTokens () {
        const data = {
            "jsonrpc": "1.0",
            "method": "listprivacycustomtoken",
            "params": [],
            "id": 1
        };

        let response;
        try {
            response = await this.rpcHttpService.postRequest(data);
        } catch (e) {
            throw new CustomError(ErrorObject.GetListPrivacyTokenErr, "Can't request API get privacy token list");
        }

        if (response.status !== 200) {
            throw new CustomError(ErrorObject.GetListPrivacyTokenErr, "Can't request API get privacy token list");
        } else if (response.data.Error) {
            throw new CustomError(ErrorObject.GetListPrivacyTokenErr, response.data.Error.Message);
        }

        let pTokens = response.data.Result.ListCustomToken;
        // decode txinfo for each ptoken
        for (let i = 0; i < pTokens.length; i++) {
            if (pTokens[i].TxInfo !== undefined && pTokens[i].TxInfo !== "") {
                let infoDecode = checkDecode(pTokens[i].TxInfo).bytesDecoded;
                let infoDecodeStr = bytesToString(infoDecode);
                pTokens[i].TxInfo = infoDecodeStr;
            }
        }

        return {
            listPrivacyToken: pTokens,
        }
    };

    async getUnspentCustomToken (paymentAddrSerialize, tokenIDStr) {
        const data = {
            "jsonrpc": "1.0",
            "method": "listunspentcustomtoken",
            "params": [paymentAddrSerialize, tokenIDStr],
            "id": 1
        };

        let response;
        try {
            response = await this.rpcHttpService.postRequest(data);
        } catch (e) {
            throw e;
        }
        if (response.data.Result) {
            return {
                listUnspentCustomToken: response.data.Result,
            }
        }
    };

    async getEstimateFeePerKB (paymentAddrSerialize, tokenIDStr = null) {
        return {
            unitFee: 10
        }
    };

    async getTransactionByHash (txHashStr) {
        const data = {

            "method": "gettransactionbyhash",
            "params": [
                txHashStr,
            ],
            "id": 1
        };

        let response;
        try {
            response = await this.rpcHttpService.postRequest(data);
        } catch (e) {
            throw e;
        }

        if (response.status !== 200) {
            throw new Error("Can't request API get transaction by hash");
        } else if (response.data.Result === null && response.data.Error) {
            return {
                isInBlock: false,
                isInMempool: false,
                blockHash: "",
                err: response.data.Error
            }
        }

        return {
            isInBlock: response.data.Result.IsInBlock,
            isInMempool: response.data.Result.IsInMempool,
            blockHash: response.data.Result.BlockHash,
            err: null
        }
    }

    async getBlockByHash (bh) {
        const data = {

            "method": "retrieveblock",
            "params": [
                bh, "1"
            ],
            "id": 1
        };

        let response;
        try {
            response = await this.rpcHttpService.postRequest(data);
        } catch (e) {
            throw e;
        }

        if (response.status !== 200) {
            throw new Error("Can't request API get block by hash");
        } else if (response.data.Result === null && response.data.Error) {
            return {};
        }

        return response.data.Result;
    }

    async getStakingAmount (type) {
        const data = {
            "jsonrpc": "1.0",
            "method": "getstakingamount",
            "params": [type],
            "id": 1
        };

        let response;
        try {
            response = await this.rpcHttpService.postRequest(data);
        } catch (e) {
            throw new CustomError(ErrorObject.GetStakingAmountErr, "Can't request API get staking amount");
        }

        if (response.status !== 200) {
            throw new CustomError(ErrorObject.GetStakingAmountErr, "Can't request API get staking amount");
        } else if (response.data.Error) {
            throw new CustomError(ErrorObject.GetStakingAmountErr, response.data.Error.Message || "Can't request API get staking amount");
        }

        return {
            res: Number(response.data.Result)
        }
    }

    async getActiveShard () {
        const data = {
            "jsonrpc": "1.0",
            "method": "getactiveshards",
            "params": [],
            "id": 1
        };

        let response;
        try {
            response = await this.rpcHttpService.postRequest(data);
        } catch (e) {
            throw new CustomError(ErrorObject.GetActiveShardErr, "Can't request API get active shard nunber");
        }

        if (response.status !== 200) {
            throw new CustomError(ErrorObject.GetActiveShardErr, "Can't request API get active shard nunber");
        } else if (response.data.Error) {
            throw new CustomError(ErrorObject.GetActiveShardErr, response.data.Error.Message || "Can't request API get active shard nunber");
        }

        return {
            shardNumber: parseInt(response.data.Result)
        }
    }

    async getMaxShardNumber () {
        const data = {
            "jsonrpc": "1.0",
            "method": "getmaxshardsnumber",
            "params": [],
            "id": 1
        };

        let response;
        try {
            response = await this.rpcHttpService.postRequest(data);
        } catch (e) {
            throw new CustomError(ErrorObject.GetMaxShardNumberErr, "Can't request API get max shard number");
        }

        if (response.status !== 200) {
            throw new CustomError(ErrorObject.GetMaxShardNumberErr, "Can't request API get max shard number");
        } else if (response.data.Error) {
            throw new CustomError(ErrorObject.GetMaxShardNumberErr, response.data.Error.Message);
        }

        return {
            shardNumber: parseInt(response.data.Result)
        }
    }

    async hashToIdenticon (hashStrs) {
        const data = {
            "jsonrpc": "1.0",
            "method": "hashtoidenticon",
            "params": hashStrs,
            "id": 1
        };

        let response;
        try {
            response = await this.rpcHttpService.postRequest(data);
        } catch (e) {
            throw new CustomError(ErrorObject.HashToIdenticonErr, "Can't request API get image from hash string");
        }

        if (response.status !== 200) {
            throw new CustomError(ErrorObject.HashToIdenticonErr, "Can't request API get image from hash string");
        } else if (response.data.Error) {
            throw new CustomError(ErrorObject.HashToIdenticonErr, response.data.Error.Message);
        }

        return {
            images: response.data.Result
        }
    }

    async getRewardAmount (paymentAddrStr) {
        const data = {
          "jsonrpc": "1.0",
          "method": "getrewardamount",
          "params": [paymentAddrStr],
          "id": 1
        };

        let response;
        try {
          response = await this.rpcHttpService.postRequest(data);
        } catch (e) {
          throw e;
        }

        if (response.status !== 200) {
          throw new Error("Can't request API get image from hash string");
        } else if (response.data.Error) {
          throw response.data.Error;
        }

        return {
          rewards: response.data.Result
        }
      }

      async getBeaconBestState () {
        const data = {
          "jsonrpc": "1.0",
          "method": "getbeaconbeststate",
          "params": [],
          "id": 1
        };

        let response;
        try {
          response = await this.rpcHttpService.postRequest(data);
        } catch (e) {
          throw e;
        }

        if (response.status !== 200) {
          throw new Error("Can't request API get beacon best state");
        } else if (response.data.Error) {
          throw response.data.Error;
        }

        return {
          bestState: response.data.Result
        }
      };

      async getPublicKeyRole (publicKey) {
        const data = {
          "jsonrpc": "1.0",
          "method": "getpublickeyrole",
          "params": [publicKey],
          "id": 1
        };

        let response;
        try {
          response = await this.rpcHttpService.postRequest(data);
        } catch (e) {
          throw e;
        }

        if (response.status !== 200) {
          throw new Error("Can't request API get public key role");
        } else if (response.data.Error) {
          throw response.data.Error;
        }

        return {
          status: response.data.Result
        }
      }

      async getPDEState (beaconHeight) {
        const data = {
          "jsonrpc": "1.0",
          "method": "getpdestate",
          "params": [{
            "BeaconHeight": beaconHeight
          }],
          "id": 1
        };

        let response;
        try {
          response = await this.rpcHttpService.postRequest(data);
        } catch (e) {
          throw e;
        }

        if (response.status !== 200) {
          throw new Error("Can't request API get PDE state");
        } else if (response.data.Error) {
          throw response.data.Error;
        }

        return {
          state: response.data.Result
        }
      }

      async getPDETradeStatus (txId) {
        const data = {
          "id": 1,
          "jsonrpc": "1.0",
          "method": "getpdetradestatus",
          "params": [
            {
              "TxRequestIDStr": txId
            }
          ]
        };

        let response;
        try {
          response = await this.rpcHttpService.postRequest(data);
        } catch (e) {
          throw e;
        }

        if (response.status !== 200) {
          throw new Error("Can't request API get PDE state");
        } else if (response.data.Error) {
          throw response.data.Error;
        }

        return {
          state: response.data.Result
        }
      }

      async getPDEContributionStatus (pairId) {
        const data = {
          "id": 1,
          "jsonrpc": "1.0",
          "method": "getpdecontributionstatus",
          "params": [
            {
              "ContributionPairID": pairId
            }
          ]
        };

        let response;
        try {
          response = await this.rpcHttpService.postRequest(data);
        } catch (e) {
          throw e;
        }

        if (response.status !== 200) {
          throw new Error("Can't request API getPDEContributionStatus");
        } else if (response.data.Error) {
          throw response.data.Error;
        }

        return {
          state: response.data.Result
        }
      }

      async getPDEContributionStatusV2 (pairId) {
        const data = {
            "id": 1,
            "jsonrpc": "1.0",
            "method": "getpdecontributionstatusv2",
            "params": [
                {
                    "ContributionPairID": pairId
                }
            ]
        };

        let response;
        try {
            response = await this.rpcHttpService.postRequest(data);
        } catch (e) {
            throw e;
        }

        if (response.status !== 200) {
            throw new Error("Can't request API getPDEContributionStatus");
        } else if (response.data.Error) {
            throw response.data.Error;
        }

        return {
            state: response.data.Result
        }
    }

      async getPDEWithdrawalStatus (txId) {
        const data = {
          "id": 1,
          "jsonrpc": "1.0",
          "method": "getpdewithdrawalstatus",
          "params": [
            {
              "TxRequestIDStr": txId
            }
          ]
        };

        let response;
        try {
          response = await this.rpcHttpService.postRequest(data);
        } catch (e) {
          throw e;
        }

        if (response.status !== 200) {
          throw new Error("Can't request API getPDEWithdrawalStatus");
        } else if (response.data.Error) {
          throw response.data.Error;
        }

        return {
          state: response.data.Result
        }
      }

      async getBlockChainInfo () {
        return parseResponse(this.rpcHttpService, 'getblockchaininfo');
      };

      async listRewardAmount () {
        return parseResponse(this.rpcHttpService, 'listrewardamount');
      };

      async getBeaconBestStateDetail () {
        return parseResponse(this.rpcHttpService, 'getbeaconbeststatedetail');
      };

      async getBeaconHeight () {
        const data = await this.getBlockChainInfo();
        return data.BestBlocks['-1'].Height;
      };

    /**
     *
     * @param {string} tokenIDStr1
     * @param {string} tokenIDStr2, default is PRV
     */
    async isExchangeRatePToken (tokenIDStr1, tokenIDStr2 = "") {
        if (tokenIDStr2 === "") {
            tokenIDStr2 = PRVIDSTR;
        }

        const beaconHeight = await this.getBeaconHeight();
        const pdeStateRes = await this.getPDEState(beaconHeight);



        let tokenIDArray = [tokenIDStr1, tokenIDStr2];
        tokenIDArray.sort();

        let keyValue = PDEPOOLKEY + "-" + beaconHeight + "-"
            + tokenIDArray[0] + "-" + tokenIDArray[1];



        if (pdeStateRes.state.PDEPoolPairs[keyValue] !== null && pdeStateRes.state.PDEPoolPairs[keyValue] !== undefined) {
            if (tokenIDArray[0] == PRVIDSTR && pdeStateRes.state.PDEPoolPairs[keyValue].Token1PoolValue < 10000 * 1e9) {
                return false;
            }

            if (tokenIDArray[1] == PRVIDSTR && pdeStateRes.state.PDEPoolPairs[keyValue].Token2PoolValue < 10000 * 1e9) {
                return false;
            }

            return true;
        }
        return false;
    }

    async getTransactionByReceiver (paymentAdrr, viewingKey) {
        let data = {
            "jsonrpc": "1.0",
            "method": "gettransactionbyreceiver",
            "params": [{
                "PaymentAddress": paymentAdrr,
                "ReadonlyKey": viewingKey,
            }
            ],
            "id": 1
        };

        let response;
        try {
            response = await this.rpcHttpService.postRequest(data);
        } catch (e) {
            throw e;
        }

        if (response.status !== 200) {
            throw new Error("Can't request API get all output coins");
        } else if (response.data.Error) {
            throw response.data.Error;
        }

        let result = response.data.Result;
        return {
            receivedTransactions: result.ReceivedTransactions,
        }
    };

    async getListPrivacyCustomTokenBalance (privateKey, tokenID) {
        if (!tokenID){
            tokenID = PRVIDSTR;
        }
        const data = {
            "jsonrpc": "1.0",
            "method": "getbalanceprivacycustomtoken",
            "params": [privateKey, tokenID],
            "id": 1
        };

        let response;
        try {
            response = await this.rpcHttpService.postRequest(data);
        } catch (e) {
            throw e;
        }

        if (response.status !== 200) {
            throw new Error("Can't request API get list privacy custom token balance");
        } else if (response.data.Error) {
            throw response.data.Error;
        }

        return response.data.Result;
    }

    async getBurningAddress (beaconHeight = 0) {
        const data = {
            "jsonrpc": "1.0",
            "method": "getburningaddress",
            "params": [beaconHeight],
            "id": 1
        };

        let response;
        try {
            response = await this.rpcHttpService.postRequest(data);
        } catch (e) {
            throw e;
        }

        if (response.status !== 200) {
            throw new Error("Can't request API get burning address");
        } else if (response.data.Error) {
            throw response.data.Error;
        }

        return response.data.Result;
    }

    // TODO : burning and issuing can be made offline
    async burnTokenToContract (privateKey, tokenID, amount, toEthAddress, isForContract = true) {
    	let temp = await this.getBeaconBestState();
    	const beaconHeight = temp.bestState.BeaconHeight;
        const burnAddr = await this.getBurningAddress(beaconHeight);
        let receivers = {};
        receivers[burnAddr] = amount;
        let method = "createandsendburningrequest";
        if (isForContract){
            method = "createandsendburningfordeposittoscrequest";
        }
        const data = {
            "jsonrpc": "1.0",
            "method": method,
            "params": [
                privateKey,
                null,
                5,
                -1,
                {
                    "TokenID": tokenID,
                    "TokenName": "",
                    "TokenSymbol": "",
                    "TokenTxType": 1,
                    "TokenAmount": amount,
                    "TokenReceivers": receivers,
                    "RemoteAddress": toEthAddress.length==40 ? toEthAddress : toEthAddress.slice(2),
                    "Privacy" : true,
                    "TokenFee": 0
                },
                "",
                0,
            ],
            "id": 1
        };

        let response;
        try {
            response = await this.rpcHttpService.postRequest(data);
        } catch (e) {
            throw e;
        }

        if (response.status !== 200) {
            throw new Error("Can't request API get burning address");
        } else if (response.data.Error) {
            throw response.data.Error;
        }
        // console.log(response.data.Result);
        return response.data.Result;
    }

    async getBurnProof (txId) {
        const data = {
            "jsonrpc": "1.0",
            "method": "getburnproof",
            "params": [txId],
            "id": 1
        };

        let response;
        try {
            response = await this.rpcHttpService.postRequest(data);
        } catch (e) {
            throw e;
        }

        if (response.status !== 200) {
            throw new Error("Can't request API get burning address");
        } else if (response.data.Error) {
            throw response.data.Error;
        }

        return response.data.Result;
    };

    async issueIncToken (privateKey, tokenID, ethBlockHash, ethDepositProof, txIndex) {
        const data = {
            "jsonrpc": "1.0",
            "method": "createandsendtxwithissuingethreq",
            "params": [
                privateKey,
                null,
                5,
                -1,
                {
					"IncTokenID": tokenID,
					"BlockHash":  ethBlockHash,
					"ProofStrs":  ethDepositProof,
					"TxIndex":    txIndex
				}
            ],
            "id": 1
        };

        let response;
        try {
            response = await this.rpcHttpService.postRequest(data);
        } catch (e) {
            throw e;
        }

        if (response.status !== 200) {
            throw new Error("Can't request API get burning address");
        } else if (response.data.Error) {
            throw response.data.Error;
        }
        // console.log(response.data.Result);
        return response.data.Result;
    }
    // END TODO

    async getNodeTime () {
        const data = await parseResponse(this.rpcHttpService, 'getnetworkinfo', "");
        return data.NodeTime;
    };

    async submitKey (sk) {
        const data = {
            "jsonrpc": "1.0",
            "method": "submitkey",
            "params": [sk],
            "id": 1
        };

        let response;
        try {
            response = await this.rpcHttpService.postRequest(data);
        } catch (e) {
            throw e;
        }

        if (response.status !== 200) {
            throw new Error("Can't request API get burning address");
        } else if (response.data.Error) {
            throw response.data.Error;
        }

        return response.data.Result;
    };

    async createAndSendRPC (privateKeyStr, paymentInfos) {
        const data = {
            "jsonrpc": "1.0",
            "method": "createandsendtransaction",
            "params": [privateKeyStr, paymentInfos, 1, 1],
            "id": 1
        };

        let response;
        try {
            response = await this.rpcHttpService.postRequest(data);
        } catch (e) {
            throw e;
        }

        if (response.status !== 200) {
            throw new Error("Can't request API get burning address");
        } else if (response.data.Error) {
            throw response.data.Error;
        }

        return response.data.Result;
    }
}

export { RpcClient };
