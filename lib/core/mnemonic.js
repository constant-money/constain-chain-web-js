import * as bip39 from 'bip39';

function newMnemonic() {
  return bip39.generateMnemonic();
}

function newSeed(mnemonic) {
  return bip39.mnemonicToSeedSync(mnemonic)
}

function validateMnemonic(mnemonic) {
  return bip39.validateMnemonic(mnemonic);
}

export {
  newMnemonic,
  newSeed,
  validateMnemonic,
};
