import { writeFileSync } from "node:fs";
import {
  formatEther,
  hexToBigInt,
  parseEther,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { makeWalletClient } from "./clients.js";
import { env, txUrl, type AppConfig, type CliOptions } from "./config.js";
import { createOpenSea, OpenSeaError, publicStage } from "./opensea.js";
import {
  alreadyMinted,
  encodeMintPublic,
  publicWindow,
  readFeeRecipient,
  readPublicDrop,
} from "./seadrop.js";
import { shortAddr, type LoadedWallet } from "./wallets.js";

export type MintResult = {
  wallet: Address;
  ok: boolean;
  skipped?: string;
  hash?: Hex;
  error?: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitForPublicLive(client: PublicClient, cfg: AppConfig = env()): Promise<void> {
  let lastLog = 0;
  for (;;) {
    const [drop, block] = await Promise.all([readPublicDrop(client, cfg), client.getBlock()]);
    const now = Number(block.timestamp);
    const window = publicWindow(drop, now);
    const remaining = drop.startTime - now;

    if (window.live) {
      console.log(`Public is LIVE on-chain (block ${block.number})`);
      return;
    }
    if (window.ended) {
      throw new Error(`Public window already ended at ${new Date(drop.endTime * 1000).toISOString()}`);
    }
    if (!window.configured) {
      if (Date.now() - lastLog > 10_000) {
        console.log("Public drop not configured on-chain yet — polling…");
        lastLog = Date.now();
      }
      await sleep(2_000);
      continue;
    }

    if (remaining > 20) {
      if (Date.now() - lastLog > 5_000) {
        console.log(`Public starts in ${fmtDuration(remaining)}  (${new Date(drop.startTime * 1000).toISOString()})`);
        lastLog = Date.now();
      }
      await sleep(Math.min(remaining - 15, 5) * 1000);
      continue;
    }

    if (Date.now() - lastLog > 400) {
      console.log(`T-${remaining}s — fast polling chain time`);
      lastLog = Date.now();
    }
    await sleep(remaining > 3 ? 250 : 80);
  }
}

export async function mintAll(opts: {
  client: PublicClient;
  wallets: LoadedWallet[];
  quantity: bigint;
  mode: CliOptions["mode"];
  dryRun: boolean;
  cfg?: AppConfig;
}): Promise<MintResult[]> {
  const { client, wallets, quantity, mode, dryRun } = opts;
  const cfg = opts.cfg ?? env();
  const drop = await readPublicDrop(client, cfg);
  const feeRecipient = await readFeeRecipient(client, cfg);
  const minted = await Promise.all(wallets.map((w) => alreadyMinted(client, w.address, cfg)));
  const balances = await Promise.all(wallets.map((w) => client.getBalance({ address: w.address })));

  const cost = drop.mintPrice * quantity;
  const data = encodeMintPublic(feeRecipient, quantity, cfg);
  const gasLimit = 220_000n;
  const fees = await client.estimateFeesPerGas();
  const maxPriorityFeePerGas = bump(fees.maxPriorityFeePerGas ?? 10_000_000n, 2n);
  const maxFeePerGas = bump(fees.maxFeePerGas ?? 100_000_000n, 2n);

  const opensea = cfg.apiKey ? createOpenSea(cfg) : null;
  const results: MintResult[] = [];

  console.log(
    `\nFiring ${wallets.length} wallet(s)  mode=${mode}  qty=${quantity}  value=${formatEther(cost)} ETH  dryRun=${dryRun}`,
  );

  await Promise.all(
    wallets.map(async (wallet, i) => {
      const label = `${wallet.index} ${shortAddr(wallet.address)}`;
      if (minted[i] > 0n) {
        const result = { wallet: wallet.address, ok: false, skipped: `already minted ${minted[i]}` };
        results.push(result);
        console.log(`SKIP  ${label}  already minted`);
        return;
      }
      if (balances[i] < cost) {
        const result = {
          wallet: wallet.address,
          ok: false,
          skipped: `balance ${formatEther(balances[i])} < ${formatEther(cost)}`,
        };
        results.push(result);
        console.log(`SKIP  ${label}  underfunded`);
        return;
      }

      if (dryRun) {
        results.push({ wallet: wallet.address, ok: true, skipped: "dry-run" });
        console.log(`DRY   ${label}  would mint`);
        return;
      }

      try {
        const walletClient = makeWalletClient(wallet.privateKey, cfg);
        let to: Address = cfg.seaDropAddress;
        let txData: Hex = data;
        let value = cost;

        if (mode === "opensea") {
          if (!opensea) throw new Error("OPENSEA_API_KEY required for --mode opensea");
          const built = await opensea.buildMint(wallet.address, Number(quantity));
          to = built.to;
          txData = built.data;
          value = parseWei(built.value);
        }

        const hash = await walletClient.sendTransaction({
          chain: walletClient.chain,
          account: walletClient.account!,
          to,
          data: txData,
          value,
          gas: gasLimit,
          maxFeePerGas,
          maxPriorityFeePerGas,
        });
        results.push({ wallet: wallet.address, ok: true, hash });
        console.log(`SENT  ${label}  ${txUrl(hash, cfg.explorerUrl)}`);
      } catch (err) {
        const message = err instanceof OpenSeaError ? err.message : err instanceof Error ? err.message : String(err);
        results.push({ wallet: wallet.address, ok: false, error: message });
        console.log(`FAIL  ${label}  ${message}`);
      }
    }),
  );

  return results;
}

export async function printOpenSeaHint(cfg: AppConfig = env()): Promise<void> {
  if (!cfg.apiKey) {
    console.log("OpenSea API key not set — skipping drop API (status still works on-chain).");
    return;
  }
  try {
    const drop = await createOpenSea(cfg).getDrop();
    const pub = publicStage(drop);
    console.log(`OpenSea drop   minting=${drop.is_minting}  minted=${drop.total_supply ?? "?"}/${drop.max_supply ?? "?"}`);
    if (pub) {
      console.log(`OpenSea public ${pub.start_time} → ${pub.end_time}  ${pub.price ?? "0"} wei  ${pub.max_per_wallet}/wallet`);
    }
  } catch (err) {
    console.log(`OpenSea drop API: ${err instanceof Error ? err.message : err}`);
  }
}

export function writeResults(results: MintResult[]): void {
  const file = process.env.RESULTS_FILE || "results.json";
  writeFileSync(file, JSON.stringify(results, null, 2));
  const ok = results.filter((r) => r.ok && r.hash).length;
  const skip = results.filter((r) => r.skipped).length;
  const fail = results.filter((r) => !r.ok && !r.skipped).length;
  console.log(`\nDone. sent=${ok} skipped=${skip} failed=${fail}  wrote ${file}`);
}

export function minBalance(mintPrice: bigint, quantity: bigint, gasBuffer: bigint): bigint {
  return mintPrice * quantity + gasBuffer;
}

export function parseFundTarget(cfg: AppConfig = env()): bigint {
  return parseEther(cfg.fundTargetEth);
}

function parseWei(raw: string): bigint {
  if (raw.startsWith("0x") || raw.startsWith("0X")) return hexToBigInt(raw as Hex);
  return BigInt(raw);
}

function bump(value: bigint, mult: bigint): bigint {
  return value * mult;
}

function fmtDuration(seconds: number): string {
  if (seconds <= 0) return "now";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
