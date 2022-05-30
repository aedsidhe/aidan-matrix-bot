"use strict";

const {
  UnderwriterTransferRequest,
} = require("zero-protocol/dist/lib/UnderwriterRequest");
const { Networks, Opcode, Script } = require("bitcore-lib");
const { RenJS } = require("@renproject/ren");
const { getUTXOs } =
  require("send-crypto/build/main/handlers/BTCHandler").BTCHandler;

const ren = new RenJS("mainnet");

const encodeTransferRequestLoan = (transferRequest) => {
  const contractInterface = new ethers.utils.Interface([
    "function loan(address, address, uint256, uint256, address, bytes, bytes)",
  ]);
  return contractInterface.encodeFunctionData("loan", [
    transferRequest.destination(),
    transferRequest.asset,
    transferRequest.amount,
    transferRequest.pNonce,
    transferRequest.module,
    transferRequest.data,
    transferRequest.signature,
  ]);
};

con;

const computePHash = (transferRequest) => {
  return ethers.utils.solidityKeccak256(
    ["bytes"],
    [
      ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256", "address", "bytes"],
        [
          transferRequest.destination(),
          transferRequest.pNonce,
          transferRequest.module,
          transferRequest.data,
        ]
      ),
    ]
  );
};

const computeGHash = (transferRequest) => {
  return ethers.utils.solidityKeccak256(
    ["bytes32", "address", "address", "bytes32"],
    [
      computePHash(transferRequest),
      transferRequest.asset,
      transferRequest.destination(),
      transferRequest.nonce,
    ]
  );
};

const addHexPrefix = (s) => (s.substr(0, 2) === "0x" ? s : "0x" + s);

const stripHexPrefix = (s) => (s.substr(0, 2) === "0x" ? s.substr(2) : s);

const computeGatewayAddress = (transferRequest, mpkh) =>
  new Script()
    .add(Buffer.from(stripHexPrefix(computeGHash(g)), "hex"))
    .add(Opcode.OP_DROP)
    .add(Opcode.OP_DUP)
    .add(Opcode.OP_HASH160)
    .add(Buffer.from(stripHexPrefix(mpkh), "hex"))
    .add(Opcode.OP_EQUALVERIFY)
    .add(Opcode.OP_CHECKSIG)
    .toScriptHashOut()
    .toAddress(false)
    .toString();

const getBTCBlockNumber = async () => 0; // unused anyway
const CONTROLLER_DEPLOYMENTS = {
  "0x53f38bEA30fE6919e0475Fe57C2629f3D3754d1E": 42161,
  "0x85dAC4da6eB28393088CF65b73bA1eA30e7e3cab": 137,
  "0xa8BD3FfEbF92538b3b830DD5B2516A5111DB164D": 1,
};

const getChainId = (request) => {
  return (
    CONTROLLER_DEPLOYMENTS[ethers.utils.getAddress(request.contractAddress)] ||
    (() => {
      throw Error("no controller found: " + request.contractAddress);
    })()
  );
};

const PendingProcess = (exports.PendingProcess = class PendingProcess {
  constructor({ redis, mpkh }) {
    this.redis = redis;
    this.mpkh = Promise.resolve(mpkh) || ren.selectPublicKey(); // TODO: figure out the right RenJS function to call to get mpkh
  }
  async timeout(ms) {
    return await new Promise((resolve) => setTimeout(resolve, ms));
  }
  async runLoop() {
    const mpkh = await this.mpkh;
    const length = await this.redis.llen("/zero/pending");
    while (true) {
      try {
        for (let i = 0; i < length; i++) {
          const item = await this.redis.lindex("/zero/pending", i);
          try {
            const transferRequest = JSON.parse(item);
            const gatewayAddress = computeGatewayAddress(transferRequest, mpkh);
            const blockNumber = await getBTCBlockNumber(); // TODO: implement getBTCBlockNumber using blockdaemon shared node
            const utxos = await getUTXOs({
              address: gatewayAddress,
              confirmations: 1,
            });
            if (utxos && utxos.length) {
              await this.redis.ldel("/zero/pending", i);
              if (
                transferRequest.contractAddress !==
                BadgerBridgeZeroController.address
              )
                await this.redis.lpush("/zero/dispatch", {
                  to: transferRequest.contractAddress,
                  data: encodeTransferRequestLoan(transferRequest),
                  chainId: getChainId(transferRequest),
                }); // TODO: implement encodeTransferRequestLoan
              await this.redis.rpush(
                "/zero/watch",
                JSON.stringify({
                  blockNumber,
                  transferRequest,
                })
              );
            }
          } catch (e) {
            this.logger.error(e);
          }
          await this.timeout(500); // Probably won't get rate limited
        }
        await this.timeout(500);
      } catch (e) {
        this.logger.error(e);
      }
    }
  }
});
