require('@babel/register');
require("@babel/polyfill");
// Set options as a parameter, environment variable, or rc file.
// this depends on Node v12 and esm.
require = require("esm")(module/*, options*/)
// module.exports = require("./main.js")

// we leave node_specific requires out of the wasm loader for webpack to avoid importing node_crypto
// so we use a different loader file for testing
const {load} = require('../lib/wasm/loader-node');
const wasm = load("./privacy.wasm");
// require("./privacy/hybridenc-test");
// require("./wallet/wallet-test");
require("./wallet/accountwallet-test");
// require("./rpc/rpc-test");
