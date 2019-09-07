import { Wallet, DefaultStorage } from '../../lib/wallet/wallet'
import { RpcClient } from "../../lib/rpcclient/rpcclient";

const rpcClient = new RpcClient("https://test-node.incognito.org");

async function TestInitWallet() {
  Wallet.RpcClient = rpcClient;
  // let wallet = new Wallet()
  // let storage = new DefaultStorage();
  // wallet.init("12345678", 0, "Wallet", storage);
  // wallet.save("12345678")

  let wallet2 = new Wallet()
  wallet2.init("1", 1, "Wallet", new DefaultStorage())
  // wallet2.Storage = storage
  // await wallet2.loadWallet("12345678")

  wallet2.createNewAccount("Test 2")
  // let privKey = wallet2.exportAccountPrivateKey(0)

  let accounts = wallet2.listAccount();
  console.log("accounts: ", accounts);
}
TestInitWallet()