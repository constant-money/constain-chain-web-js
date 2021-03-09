const Elliptic = require('elliptic').ec;

const secp256k1 = new Elliptic('secp256k1');
const { hashKeccakBytesToBytes } = require("./utils");

// generateECDSAKeyPair generates ECDSA key pair from seed
function generateECDSAKeyPair(seed) {
    let hash = hashKeccakBytesToBytes(seed);
		let keyPair = secp256k1.keyFromPrivate(hash);
		let privateKey = keyPair.getPrivate();
		let publicKey = keyPair.getPublic();

		return {
				ecdsaPrivateKey: privateKey.toArray(),
				ecdsaPublicKey: publicKey.encodeCompressed()
		}
}

export {
    generateECDSAKeyPair,
}
