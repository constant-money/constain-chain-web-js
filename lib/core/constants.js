const PriKeyType = 0x0; // Serialize wallet account key into string with only PRIVATE KEY of account KeySet
const PaymentAddressType = 0x1; // Serialize wallet account key into string with only PAYMENT ADDRESS of account KeySet
const ReadonlyKeyType = 0x2; // Serialize wallet account key into string with only READONLY KEY of account KeySet
// const PublicKeyType = 0x3; // Serialize wallet account key into string with only READONLY KEY of account KeySet
const OTAKeyType = 0x3;

const PriKeySerializeSize = 71;
const PaymentAddrSerializeSize = 67;
const ReadonlyKeySerializeSize = 67;
const OTAKeySerializeSize = 67;
// const PublicKeySerializeSize = 34;

const PriKeySerializeAddCheckSumSize = 75;
const PaymentAddrSerializeAddCheckSumSize = 71;
const ReadonlyKeySerializeAddCheckSumSize = 71;
const OTAKeySerializeAddCheckSumSize = 71;

const FailedTx = 0;
const SuccessTx = 1;
const ConfirmedTx = 2;

// for staking tx
// amount in mili constant
const MetaStakingBeacon = 64;
const MetaStakingShard = 63;
const StopAutoStakingMeta = 127;

const ShardStakingType = 0;
const BeaconStakingType = 1;

const MaxTxSize = 100; // in kb

const ChildNumberSize = 4;
const ChainCodeSize = 32;
const PrivacyUnit = 1e9;
const NanoUnit = 1e-9;

const BurnAddress =
    "12RxahVABnAVCGP3LGwCn8jkQxgw7z1x14wztHzn455TTVpi1wBq9YGwkRMQg3J4e657AbAnCvYCJSdA9czBUNuCKwGSRQt55Xwz8WA";

const BurningRequestMeta = 27;
const WithDrawRewardRequestMeta = 44;
const PDEContributionMeta = 90;
const PDETradeRequestMeta = 91;
const PDETradeResponseMeta = 92;
const PDEWithdrawalRequestMeta = 93;
const PDEWithdrawalResponseMeta = 94;

const PDEPRVRequiredContributionRequestMeta = 204;
const PDECrossPoolTradeRequestMeta = 205;
const PDECrossPoolTradeResponseMeta = 206;
const PDEFeeWithdrawalRequestMeta = 207;
const PDEFeeWithdrawalResponseMeta = 208;
const PDETradingFeesDistributionMeta = 209;

const PRVID = [4];
const PRVIDSTR = "0000000000000000000000000000000000000000000000000000000000000004";
const PDEPOOLKEY = "pdepool";

const NoStakeStatus = -1;
const CandidatorStatus = 0;
const ValidatorStatus = 1;

const MenmonicWordLen = 12;
const PercentFeeToReplaceTx = 10;
const MaxSizeInfoCoin = 255;

const BIP44_COIN_TYPE = 587;

export {
    PriKeyType,
    PaymentAddressType,
    ReadonlyKeyType,
    // PublicKeyType,
    OTAKeyType,
    PriKeySerializeSize,
    PaymentAddrSerializeSize,
    ReadonlyKeySerializeSize,
    // PublicKeySerializeSize,
    OTAKeySerializeSize,
    FailedTx,
    SuccessTx,
    ConfirmedTx,
    MetaStakingBeacon,
    MetaStakingShard,
    ShardStakingType,
    BeaconStakingType,
    MaxTxSize,
    ChildNumberSize,
    ChainCodeSize,
    PercentFeeToReplaceTx,
    PrivacyUnit,
    NanoUnit,
    BurnAddress,
    BurningRequestMeta,
    WithDrawRewardRequestMeta,
    PRVID,
    NoStakeStatus,
    CandidatorStatus,
    ValidatorStatus,
    PDEContributionMeta,
    PDETradeRequestMeta,
    PDETradeResponseMeta,
    PDEWithdrawalRequestMeta,
    PDEWithdrawalResponseMeta,
    PRVIDSTR,
    PDEPOOLKEY,
    PriKeySerializeAddCheckSumSize,
    PaymentAddrSerializeAddCheckSumSize,
    ReadonlyKeySerializeAddCheckSumSize,
    MenmonicWordLen,
    MaxSizeInfoCoin,
    StopAutoStakingMeta,
    PDEPRVRequiredContributionRequestMeta,
    PDECrossPoolTradeRequestMeta,
    PDECrossPoolTradeResponseMeta,
    PDEFeeWithdrawalRequestMeta,
    PDEFeeWithdrawalResponseMeta,
    PDETradingFeesDistributionMeta,
    BIP44_COIN_TYPE,
};
