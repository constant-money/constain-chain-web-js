const { ED25519_KEY_SIZE } = require('./constants');

const { SHA3, Keccak } = require('sha3');
const { toByteArray, fromByteArray } = require('base64-js');
const bn = require('bn.js');

// It is used for random bytes on mobile
let randBytesFunc = null;

function setRandBytesFunc(f) {
  randBytesFunc = f;
}

function getRandBytesFunc() {
  return randBytesFunc;
}

import CryptoJS from 'crypto-js';
// randBytes generates a random bytes array with specific size n
async function randBytes(n = ED25519_KEY_SIZE) {
  try {
    // let paranoiaLvl = 6; //256bit entropy https://github.com/bitwiseshiftleft/sjcl/issues/156
    // let wordLength = (n >> 2) + 1;
    let words = CryptoJS.lib.WordArray.random(n);
    // let res = sjcl.codec.bytes.fromBits(words);
    let buf = Buffer.from(words.toString(CryptoJS.enc.Hex),'hex');
    let res = Uint8Array.from(buf);
    return res.slice(0, n);
  } catch (e) {

    let randomFunc = getRandBytesFunc();
    if (randomFunc) {
      return randomFunc(n);
    } else {
      throw Error('Utility.RandomBytesFunc is null');
    }
  }
}

// randScalar generates a random big integer which is less than degree of the curve
async function randScalar(n = ED25519_KEY_SIZE) {
  let randNum = new bn("0");
  const curveDeg = P256.n;

  do {
    let randbytes = randBytes(n);
    randNum = new bn(randbytes, 10, "be");
  } while (randNum.cmp(curveDeg) !== -1);
  return randNum;
}

// addPaddingBigInt adds padding to a big integer with fixedSize
function addPaddingBigInt(numInt, fixedSize) {
  return numInt.toArray("be", fixedSize);
}

// intToByteArr receives an integer and converts it to 2-byte array
function intToByteArr(n) {
  let newNum = new bn(n);
  let bytes = newNum.toArray("be");
  if (bytes.length > 2) {
    return []
  } else return newNum.toArray("be", 2);

}

// byteArrToInt receives 2-byte array and reverts it to an integer
function byteArrToInt(bytesArr) {
  let num = new bn(bytesArr, 16, "be");
  return parseInt(num.toString(10));
}

// CheckDuplicateBigIntArray returns true if there are at least 2 elements in an array have same values
function checkDuplicateBigIntArray(arr) {
  let set = new Set(arr);
  if (set.size !== arr.length) {
    return true;
  }
  return false;
}

// convertIntToBinary receives an integer and converts it to binary array with length n
function convertIntToBinary(num, n) {
  // let bytes = new Uint8Array(n);
  // for (let i = 0; i < n; i++) {
  //   bytes[i] = num & 1;
  //   num >>= 1;
  // }
  // return bytes;

  let bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    bytes[i] = num % 2;
    num = num / 2;
  }
  return bytes;
}

// // convertIntToBinary receives a binary array and reverts it to integer
function convertBinaryToInt(binary) {
  let number = new bn(0);
  for (let i = 0; i < binary.length; i++) {
    if (binary[i] == 1) {
      let tmp = new bn(2);
      tmp = tmp.pow(new bn(i));
      number = number.add(tmp);
    }
  }

  return number;
}

// hashSha3BytesToBytes receives a bytes array data and use SHA3 to hash that data
// returns hashing in bytes array
function hashSha3BytesToBytes(data) {
  data = new Uint8Array(data)
  let temp = Buffer.from(data);
  let result = new SHA3(256).update(temp);
  result = result.digest()
  return [...new Uint8Array(result)];
}

function hashKeccakBytesToBytes(data) {
  data = new Uint8Array(data)
  let temp = Buffer.from(data);
  const hash = new Keccak(256);

  let hash2 = hash.update(temp);

  return [...new Uint8Array(hash2.digest())];
}

// convertUint8ArrayToArray receives data in Uint8Array and returns a bytes array
function convertUint8ArrayToArray(data) {
  return [...data];
}

// stringToBytes converts string to bytes array
function stringToBytes(str) {
  var ch, st, re = [];
  for (var i = 0; i < str.length; i++) {
    ch = str.charCodeAt(i);  // get char
    st = [];                 // set up "stack"
    do {
      st.push(ch & 0xFF);  // push byte to stack
      ch = ch >> 8;          // shift value down by 1 byte
    }
    while (ch);
    // add stack contents to result
    // done because chars have "wrong" endianness
    re = re.concat(st.reverse());
  }
  // return an array of bytes
  return re;
}

function bytesToString(data)
  {
    const extraByteMap = [ 1, 1, 1, 1, 2, 2, 3, 0 ];
    var count = data.length;
    var str = "";

    for (var index = 0;index < count;)
    {
      var ch = data[index++];
      if (ch & 0x80)
      {
        var extra = extraByteMap[(ch >> 3) & 0x07];
        if (!(ch & 0x40) || !extra || ((index + extra) > count))
          return null;

        ch = ch & (0x3F >> extra);
        for (;extra > 0;extra -= 1)
        {
          var chx = data[index++];
          if ((chx & 0xC0) != 0x80)
            return null;

          ch = (ch << 6) | (chx & 0x3F);
        }
      }

      str += String.fromCharCode(ch);
    }

    return str;
  }

// base64Decode decodes a base64 string to bytes array
function base64Decode(str) {
  let bytes = toByteArray(str);
  return bytes;
}

// base64Encode encodes a bytes array to base64 string
function base64Encode(bytesArray) {
  let str = fromByteArray(bytesArray);
  return str;
}

function toHexString(byteArray) {
  return Array.from(byteArray, function(byte) {
    return ('0' + (byte & 0xFF).toString(16)).slice(-2);
  }).join('')
}

function pad(l) {
  let deg = 0;
  while (l > 0) {
    if (l % 2 === 0) {
      deg++;
      l = l >> 1;
    } else {
      break;
    }
  }
  let i = 0;
  for (; ;) {
    if (Math.pow(2, i) < l) {
      i++;
    } else {
      l = Math.pow(2, i + deg);
      break;
    }
  }
  return l;
}

export {
  randScalar,
  addPaddingBigInt,
  intToByteArr,
  randBytes,
  checkDuplicateBigIntArray,
  convertIntToBinary,
  convertUint8ArrayToArray,
  stringToBytes,
  hashSha3BytesToBytes,
  setRandBytesFunc,
  base64Decode,
  base64Encode,
  convertBinaryToInt,
  hashKeccakBytesToBytes,
  toHexString,
  pad,
  bytesToString
};

