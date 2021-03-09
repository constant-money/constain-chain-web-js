module wasm

go 1.14

require incognito-chain v0.2.0

replace incognito-chain v0.2.0 => ./internal

require (
	github.com/btcsuite/btcd v0.20.1-beta // indirect
	github.com/ebfe/keccak v0.0.0-20150115210727-5cc570678d1b // indirect
	github.com/pkg/errors v0.9.1 // indirect
	github.com/stretchr/testify v1.7.0 // indirect
	gobridge v0.1.0
)

replace gobridge v0.1.0 => ./gobridge
