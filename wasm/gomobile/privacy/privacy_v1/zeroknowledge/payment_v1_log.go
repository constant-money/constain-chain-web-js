package zkp

import (
	"incognito-chain/common"
	agg "incognito-chain/privacy/privacy_v1/zeroknowledge/aggregatedrange"
	oom "incognito-chain/privacy/privacy_v1/zeroknowledge/oneoutofmany"
	snn "incognito-chain/privacy/privacy_v1/zeroknowledge/serialnumbernoprivacy"
	snp "incognito-chain/privacy/privacy_v1/zeroknowledge/serialnumberprivacy"
	utils "incognito-chain/privacy/privacy_util"
)

type PaymentV1Logger struct {
	Log common.Logger
}

func (logger *PaymentV1Logger) Init(inst common.Logger) {
	logger.Log = inst
	agg.Logger.Init(inst)
	oom.Logger.Init(inst)
	snn.Logger.Init(inst)
	snp.Logger.Init(inst)
	utils.Logger.Init(inst)
}

// Global instant to use
var Logger = PaymentV1Logger{}