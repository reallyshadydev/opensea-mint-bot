import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";
import { fromRoot, resolveProjectPath } from "./paths.js";

loadEnv({ path: fromRoot(".env") });
loadEnv({ path: resolve(process.cwd(), ".env"), override: false });

export type MintMode = "seadrop" | "opensea";

export type CliOptions = {
  command: "status" | "check" | "fund" | "snipe" | "generate" | "key" | "simulate";
  live: boolean;
  dryRun: boolean;
  yes: boolean;
  force: boolean;
  append: boolean;
  count: number;
  limit?: number;
  quantity: number;
  mode: MintMode;
  walletsFile?: string;
  slug?: string;
  nft?: string;
};

export type AppConfig = {
  rpcUrl: string;
  apiKey: string;
  slug: string;
  nftAddress: Address;
  seaDropAddress: Address;
  feeRecipient?: Address;
  chainId: number;
  chainName: string;
  nativeSymbol: string;
  explorerUrl: string;
  openseaApi: string;
  openseaChain: string;
  gasBufferWei: bigint;
  fundTargetEth: string;
  fundingKey?: Hex;
  mode: MintMode;
};

const DEFAULTS = {
  slug: "hoodbirdss",
  nftAddress: "0x14a247e9e3accbc941a705c984a49e291468bc29",
  seaDropAddress: "0x00005EA00Ac477B1030CE78506496e8C2dE24bf5",
  chainId: 4663,
  chainName: "Robinhood Chain",
  nativeSymbol: "ETH",
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  explorerUrl: "https://robinhoodchain.blockscout.com",
  openseaApi: "https://api.opensea.io",
  openseaChain: "robinhood",
} as const;

export function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  const raw = args[0] ?? "status";
  const aliased =
    raw === "prepare"
      ? "check"
      : raw === "gen" || raw === "wallets"
        ? "generate"
        : raw === "apikey"
          ? "key"
          : raw === "sim"
            ? "simulate"
            : raw;
  const command = aliased as CliOptions["command"];
  if (!["status", "check", "fund", "snipe", "generate", "key", "simulate"].includes(command)) {
    throw new Error(`Unknown command: ${raw}. Use status | check | fund | snipe | generate | key | simulate`);
  }

  const getNum = (flag: string): number | undefined => {
    const i = args.indexOf(flag);
    if (i === -1 || args[i + 1] === undefined) return undefined;
    const n = Number(args[i + 1]);
    if (!Number.isFinite(n)) throw new Error(`Invalid number for ${flag}: ${args[i + 1]}`);
    return n;
  };

  const getStr = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : args[i + 1];
  };

  const envLimit = process.env.WALLET_LIMIT ? Number(process.env.WALLET_LIMIT) : undefined;
  const envQty = process.env.QUANTITY ? Number(process.env.QUANTITY) : undefined;
  const envCount = process.env.GENERATE_COUNT ? Number(process.env.GENERATE_COUNT) : undefined;
  const envMode = process.env.MODE as MintMode | undefined;

  return {
    command,
    live: args.includes("--live"),
    dryRun: args.includes("--dry-run"),
    yes: args.includes("--yes"),
    force: args.includes("--force"),
    append: args.includes("--append"),
    count: getNum("--count") ?? (Number.isFinite(envCount) && envCount ? envCount : 1),
    limit: getNum("--limit") ?? (Number.isFinite(envLimit) ? envLimit : undefined),
    quantity: getNum("--quantity") ?? (Number.isFinite(envQty) && envQty ? envQty : 1),
    mode: (getStr("--mode") as MintMode | undefined) ?? envMode ?? "seadrop",
    walletsFile: getStr("--wallets") ?? process.env.WALLETS_FILE,
    slug: getStr("--slug"),
    nft: getStr("--nft"),
  };
}

export function env(overrides: { slug?: string; nft?: string } = {}): AppConfig {
  const slug = overrides.slug || process.env.COLLECTION_SLUG || DEFAULTS.slug;
  const nftRaw = overrides.nft || process.env.NFT_ADDRESS || DEFAULTS.nftAddress;
  const seaRaw = process.env.SEADROP_ADDRESS || DEFAULTS.seaDropAddress;
  const feeRaw = process.env.FEE_RECIPIENT;
  const chainId = Number(process.env.CHAIN_ID || DEFAULTS.chainId);
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error(`Invalid CHAIN_ID: ${process.env.CHAIN_ID}`);
  }

  const modeRaw = (process.env.MODE || "seadrop").toLowerCase();
  if (modeRaw !== "seadrop" && modeRaw !== "opensea") {
    throw new Error(`MODE must be seadrop or opensea (got ${process.env.MODE})`);
  }

  return {
    rpcUrl: process.env.RPC_URL || DEFAULTS.rpcUrl,
    apiKey: process.env.OPENSEA_API_KEY ?? "",
    slug,
    nftAddress: parseAddress(nftRaw, "NFT_ADDRESS"),
    seaDropAddress: parseAddress(seaRaw, "SEADROP_ADDRESS"),
    feeRecipient: feeRaw ? parseAddress(feeRaw, "FEE_RECIPIENT") : undefined,
    chainId,
    chainName: process.env.CHAIN_NAME || DEFAULTS.chainName,
    nativeSymbol: process.env.NATIVE_SYMBOL || DEFAULTS.nativeSymbol,
    explorerUrl: stripSlash(process.env.EXPLORER_URL || DEFAULTS.explorerUrl),
    openseaApi: stripSlash(process.env.OPENSEA_API || DEFAULTS.openseaApi),
    openseaChain: process.env.OPENSEA_CHAIN || DEFAULTS.openseaChain,
    gasBufferWei: BigInt(process.env.GAS_BUFFER_WEI || "200000000000000"),
    fundTargetEth: process.env.FUND_TARGET_ETH || "0.0012",
    fundingKey: normalizeKey(process.env.FUNDING_PRIVATE_KEY),
    mode: modeRaw,
  };
}

export function txUrl(hash: string, explorerUrl = env().explorerUrl): string {
  return `${explorerUrl}/tx/${hash}`;
}

export function walletsPath(explicit?: string): string {
  return resolveProjectPath(explicit || process.env.WALLETS_FILE, "wallets.csv");
}

export function resolveWalletsFile(explicit?: string): string {
  const path = walletsPath(explicit);
  if (!existsSync(path)) {
    throw new Error(
      `Wallet file not found: ${path}\nGenerate some with: npm run generate -- --count 5`,
    );
  }
  return path;
}

export function normalizeKey(raw?: string | null): Hex | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const hex = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!isHex(hex) || hex.length !== 66) {
    throw new Error("Private key must be 32 bytes of hex (with or without 0x)");
  }
  return hex;
}

export function parseAddress(raw: string, name: string): Address {
  const value = raw.trim();
  if (!isAddress(value)) throw new Error(`${name} is not a valid address: ${raw}`);
  return getAddress(value);
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
