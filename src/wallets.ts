import { existsSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getAddress, type Address, type Hex } from "viem";
import { normalizeKey } from "./config.js";
import { readTextFile, writeSecretFile } from "./fsutil.js";

export type LoadedWallet = {
  index: number;
  address: Address;
  privateKey: Hex;
};

export function loadWallets(filePath: string, limit?: number): LoadedWallet[] {
  const text = readTextFile(filePath);
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  if (lines.length === 0) throw new Error(`No wallets in ${filePath}`);

  const header = lines[0].toLowerCase();
  const hasHeader =
    header.includes("private_key") ||
    header.includes("privatekey") ||
    header.includes("address");
  const rows = hasHeader ? lines.slice(1) : lines;

  const wallets: LoadedWallet[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (limit !== undefined && wallets.length >= limit) break;
    const cols = row.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cols.length === 0) continue;

    let keyRaw: string | undefined;
    if (hasHeader) {
      const names = header.split(",").map((h) => h.trim());
      const keyIdx = names.findIndex((n) => n === "private_key" || n === "privatekey" || n === "key");
      keyRaw = keyIdx >= 0 ? cols[keyIdx] : cols[cols.length - 1];
    } else if (cols.length === 1) {
      keyRaw = cols[0];
    } else {
      keyRaw = cols[cols.length - 1];
    }

    const privateKey = normalizeKey(keyRaw);
    if (!privateKey) continue;

    const account = privateKeyToAccount(privateKey);
    const address = getAddress(account.address);
    if (seen.has(address.toLowerCase())) continue;
    seen.add(address.toLowerCase());

    wallets.push({ index: wallets.length + 1, address, privateKey });
  }

  if (wallets.length === 0) {
    throw new Error(`Parsed 0 wallets from ${filePath}`);
  }
  return wallets;
}

export function shortAddr(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function generateWallets(count: number): LoadedWallet[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`--count must be a positive integer (got ${count})`);
  }
  if (count > 5_000) {
    throw new Error("--count cannot exceed 5000");
  }
  return Array.from({ length: count }, (_, i) => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    return { index: i + 1, address: getAddress(account.address), privateKey };
  });
}

export function writeWalletsCsv(
  filePath: string,
  wallets: LoadedWallet[],
  opts: { force?: boolean; append?: boolean } = {},
): { written: LoadedWallet[]; total: number } {
  let existing: LoadedWallet[] = [];
  if (existsSync(filePath)) {
    if (!opts.force && !opts.append) {
      throw new Error(
        `${filePath} already exists. Pass --force to overwrite or --append to add more.`,
      );
    }
    if (opts.append) {
      existing = loadWallets(filePath);
    }
  }

  const seen = new Set(existing.map((w) => w.address.toLowerCase()));
  const added: LoadedWallet[] = [];
  let nextIndex = existing.length + 1;
  for (const wallet of wallets) {
    if (seen.has(wallet.address.toLowerCase())) continue;
    seen.add(wallet.address.toLowerCase());
    added.push({ ...wallet, index: nextIndex });
    nextIndex += 1;
  }

  const all = [...existing, ...added];
  const lines = ["index,address,private_key", ...all.map((w) => `${w.index},${w.address},${w.privateKey}`)];
  writeSecretFile(filePath, `${lines.join("\n")}\n`);
  return { written: added, total: all.length };
}
