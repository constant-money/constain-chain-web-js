//+build linux,386 wasm

package main

import (
	"gobridge"
	internal "incognito-chain"
)

func main() {
	c := make(chan struct{}, 0)

	gobridge.RegisterCallback("createTransaction", internal.CreateTransaction)
	gobridge.RegisterCallback("createConvertTx", internal.CreateConvertTx)
	
	gobridge.RegisterCallback("newKeySetFromPrivate", internal.NewKeySetFromPrivate)
	gobridge.RegisterCallback("decryptCoin", internal.DecryptCoin)
	gobridge.RegisterCallback("createCoin", internal.CreateCoin)
	gobridge.RegisterCallback("generateBLSKeyPairFromSeed", internal.GenerateBLSKeyPairFromSeed)
	gobridge.RegisterCallback("hybridEncrypt", internal.HybridEncrypt)
	gobridge.RegisterCallback("hybridDecrypt", internal.HybridDecrypt)
	gobridge.RegisterCallback("getSignPublicKey", internal.GetSignPublicKey)
	gobridge.RegisterCallback("signPoolWithdraw", internal.SignPoolWithdraw)

	// not applicable
	// gobridge.RegisterCallback("deriveSerialNumber", gomobile.DeriveSerialNumber)

	println("WASM loading finished")
	<-c
}