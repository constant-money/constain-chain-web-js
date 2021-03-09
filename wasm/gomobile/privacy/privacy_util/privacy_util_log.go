package privacy_util

import "incognito-chain/common"

type PrivacyUtilLogger struct {
	Log common.Logger
}

func (logger *PrivacyUtilLogger) Init(inst common.Logger) {
	logger.Log = inst
}

// Global instant to use
var Logger = PrivacyUtilLogger{}
