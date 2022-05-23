'use strict';

const polygongastracker = require('ethers-polygongastracker');
const gasnow = require('ethers-gasnow');
const packageJson = require('../package');
const { createLogger } = require('@zerodao/logger');
const ethers = require('ethers');

const RPC_ENDPOINTS = {
  [42161]: 'https://arb1.arbitrum.io/rpc',
  [137]: 'https://polygon-mainnet.infura.io/v3/816df2901a454b18b7df259e61f92cd2',
  [1]: 'https://mainnet.infura.io/v3/816df2901a454b18b7df259e61f92cd2',
};

const ERROR_TIMEOUT = 1000;

const Dispatcher = exports.Dispatcher = class Dispatcher {
  static RPC_ENDPOINTS = RPC_ENDPOINTS;
  static ERROR_TIMEOUT = ERROR_TIMEOUT;
  constructor({
    redis,
    gasLimit,
    logger,
    signer
  }) {
    Object.assign(this, {
      redis,
      gasLimit,
      logger,
      signer
    });
    if (!this.logger) this.logger = createLogger(packageJson.name);
    this.providers = Object.entries(this.constructor.RPC_ENDPOINTS).reduce((r, v) => {
      const provider = r[v.key] = new ethers.providers.JsonRpcProvider(v.value);
      if (v.key == 1) provider.getGasPrice = gasnow.createGetGasPrice('rapid');
      else if (v.key == 137) provider.getGasPrice = polygongastracker.createGetGasPrice('rapid');
      return r;
    }, {});
  }
  makeProvider(chainId) {
    return this.providers[chainId];
  }
  async runLoop() {
    this.logger.info('starting dispatch loop');
    while (true) {
      try {
        const txSerialized = await this.redis.lpop('/zero/dispatch');
        if (!txSerialized) {
          await this.errorTimeout();
          continue;
	}
	const tx = JSON.parse(txSerialized);
        try {
          const dispatched = await this.signer.connect(this.makeProvider(tx.chainId)).sendTransaction({
            ...tx,
            chainId: undefined,
            gasLimit: this.gasLimit
	  });
          this.logger.info('dispatched tx: ' + dispatched.hash);
        } catch (e) {
          this.logger.error(e);
          await this.redis.lpush('/zero/dispatch', tx);
          await this.errorTimeout();
	}
      } catch (e) {
        this.logger.error(e);
        await this.errorTimeout();
      }
    }
  }
  async errorTimeout() {
    await new Promise((resolve) => setTimeout(resolve, exports.ERROR_TIMEOUT));
  }
};