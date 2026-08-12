import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { makeChain } from "./chain.js";
import { env, type AppConfig } from "./config.js";

export function makePublicClient(cfg: AppConfig = env()): PublicClient {
  return createPublicClient({
    chain: makeChain(cfg),
    transport: http(cfg.rpcUrl, { timeout: 15_000, retryCount: 2 }),
  });
}

export function makeWalletClient(privateKey: Hex, cfg: AppConfig = env()): WalletClient {
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({
    account,
    chain: makeChain(cfg),
    transport: http(cfg.rpcUrl, { timeout: 15_000, retryCount: 1 }),
  });
}
