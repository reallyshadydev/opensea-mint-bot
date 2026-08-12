import {
  encodeFunctionData,
  formatEther,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { nftAbi, seaDropAbi, type PublicDrop } from "./chain.js";
import { env, type AppConfig } from "./config.js";

const OPENSEA_FEE_FALLBACK = "0x0000a26b00c1F0DF003000390027140000fAa719" as Address;

export async function readCollection(client: PublicClient, cfg: AppConfig = env()) {
  const [name, symbol, maxSupply, totalSupply] = await Promise.all([
    client.readContract({ address: cfg.nftAddress, abi: nftAbi, functionName: "name" }),
    client.readContract({ address: cfg.nftAddress, abi: nftAbi, functionName: "symbol" }),
    client.readContract({ address: cfg.nftAddress, abi: nftAbi, functionName: "maxSupply" }),
    client.readContract({ address: cfg.nftAddress, abi: nftAbi, functionName: "totalSupply" }),
  ]);
  return { name, symbol, maxSupply, totalSupply };
}

export async function readPublicDrop(client: PublicClient, cfg: AppConfig = env()): Promise<PublicDrop> {
  const drop = await client.readContract({
    address: cfg.seaDropAddress,
    abi: seaDropAbi,
    functionName: "getPublicDrop",
    args: [cfg.nftAddress],
  });
  return {
    mintPrice: drop.mintPrice,
    startTime: Number(drop.startTime),
    endTime: Number(drop.endTime),
    maxTotalMintableByWallet: drop.maxTotalMintableByWallet,
    feeBps: drop.feeBps,
    restrictFeeRecipients: drop.restrictFeeRecipients,
  };
}

export async function readFeeRecipient(client: PublicClient, cfg: AppConfig = env()): Promise<Address> {
  if (cfg.feeRecipient) return cfg.feeRecipient;
  const recipients = await client.readContract({
    address: cfg.seaDropAddress,
    abi: seaDropAbi,
    functionName: "getAllowedFeeRecipients",
    args: [cfg.nftAddress],
  });
  return (recipients[0] as Address | undefined) ?? OPENSEA_FEE_FALLBACK;
}

export async function alreadyMinted(
  client: PublicClient,
  minter: Address,
  cfg: AppConfig = env(),
): Promise<bigint> {
  const stats = await client.readContract({
    address: cfg.nftAddress,
    abi: nftAbi,
    functionName: "getMintStats",
    args: [minter],
  });
  return stats[0];
}

export function encodeMintPublic(feeRecipient: Address, quantity: bigint, cfg: AppConfig = env()): Hex {
  return encodeFunctionData({
    abi: seaDropAbi,
    functionName: "mintPublic",
    args: [cfg.nftAddress, feeRecipient, zeroAddress, quantity],
  });
}

export function publicWindow(drop: PublicDrop, nowSec: number) {
  const configured = drop.startTime > 0 && drop.endTime > drop.startTime;
  const live = configured && nowSec >= drop.startTime && nowSec <= drop.endTime;
  const upcoming = configured && nowSec < drop.startTime;
  const ended = configured && nowSec > drop.endTime;
  return { configured, live, upcoming, ended };
}

export function formatPublicDrop(drop: PublicDrop): string[] {
  return [
    `price           ${formatEther(drop.mintPrice)} ETH`,
    `start           ${iso(drop.startTime)}`,
    `end             ${iso(drop.endTime)}`,
    `max per wallet  ${drop.maxTotalMintableByWallet}`,
    `fee             ${drop.feeBps / 100}%`,
  ];
}

function iso(unix: number): string {
  if (!unix) return "(not set)";
  return `${new Date(unix * 1000).toISOString()}  (unix ${unix})`;
}
