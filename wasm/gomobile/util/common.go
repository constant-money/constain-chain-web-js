package util

import (
	"crypto/rand"
	"math/big"
	// "encoding/hex"
	// "errors"

	// "golang.org/x/crypto/sha3"
	"incognito-chain/common"
)

const(
	HashSize = 32
	MaxShardNumber = 1
	TxRandomGroupSize = 36
	MaxHashStringSize = HashSize * 2
)
const (
	TxNormalType          = "n"   // normal tx(send and receive coin)
	TxRewardType          = "s"   // reward tx
	TxReturnStakingType   = "rs"  //
	TxConversionType      = "cv"  // Convert 1 - 2 normal tx
	TxTokenConversionType = "tcv" // Convert 1 - 2 token tx
	//TxCustomTokenType        = "t"  // token  tx with no supporting privacy
	TxCustomTokenPrivacyType = "tp" // token  tx with supporting privacy
)
var(
	PRVCoinID = common.Hash{4}
)


func RandBigIntMaxRange(max *big.Int) (*big.Int, error) {
	return rand.Int(rand.Reader, max)
}
