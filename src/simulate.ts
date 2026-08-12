import { spawn, type ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { createServer } from "node:net";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  decodeErrorResult,
  formatEther,
  http,
  parseEther,
  publicActions,
  walletActions,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { makeChain } from "./chain.js";
import type { AppConfig } from "./config.js";
import { generateWallets, shortAddr, type LoadedWallet } from "./wallets.js";
import {
  alreadyMinted,
  encodeMintPublic,
  publicWindow,
  readCollection,
  readFeeRecipient,
  readPublicDrop,
} from "./seadrop.js";

const seaErrors = [
  {
    type: "error",
    name: "NotActive",
    inputs: [
      { name: "current", type: "uint256" },
      { name: "start", type: "uint256" },
      { name: "end", type: "uint256" },
    ],
  },
  { type: "error", name: "FeeRecipientNotAllowed", inputs: [] },
  { type: "error", name: "FeeRecipientCannotBeZeroAddress", inputs: [] },
  { type: "error", name: "IncorrectPayment", inputs: [{ type: "uint256" }, { type: "uint256" }] },
  {
    type: "error",
    name: "MintQuantityExceedsMaxMintedPerWallet",
    inputs: [{ type: "uint256" }, { type: "uint256" }],
  },
  {
    type: "error",
    name: "MintQuantityExceedsMaxSupply",
    inputs: [{ type: "uint256" }, { type: "uint256" }],
  },
  { type: "error", name: "MintQuantityCannotBeZero", inputs: [] },
  { type: "error", name: "PayerNotAllowed", inputs: [] },
] as const;

export type CaseResult = {
  name: string;
  ok: boolean;
  expected: boolean;
  detail: string;
};

function decodeRevert(err: unknown): string {
  const blobs: string[] = [];
  const visit = (value: unknown, depth = 0) => {
    if (value == null || depth > 4) return;
    if (typeof value === "string") {
      blobs.push(value);
      return;
    }
    if (typeof value !== "object") return;
    const rec = value as Record<string, unknown>;
    for (const key of ["data", "raw", "shortMessage", "details", "message", "cause"]) {
      if (key in rec) visit(rec[key], depth + 1);
    }
  };
  visit(err);
  const joined = blobs.join(" ");
  const selectorHit = joined.match(/custom error (0x[0-9a-fA-F]{8})/i);
  const known: Record<string, string> = {
    "0x13da22f2": "NotActive",
    "0xedc01273": "MintQuantityExceedsMaxMintedPerWallet",
    "0xe12d2314": "MintQuantityExceedsMaxSupply",
    "0x0d35e921": "IncorrectPayment",
    "0xf477d26f": "FeeRecipientNotAllowed",
    "0x5136e8d5": "FeeRecipientCannotBeZeroAddress",
    "0x198441cb": "MintQuantityCannotBeZero",
    "0x1fe7da08": "PayerNotAllowed",
  };
  if (selectorHit) {
    const name = known[selectorHit[1].toLowerCase()];
    if (name) return name;
  }
  const hex = joined.match(/0x[0-9a-fA-F]{8,}/)?.[0] as Hex | undefined;
  if (hex) {
    try {
      const decoded = decodeErrorResult({ abi: seaErrors, data: hex });
      return `${decoded.errorName}(${decoded.args?.map(String).join(", ") ?? ""})`;
    } catch {
      /* fall through */
    }
  }
  const named = joined.match(
    /\b(NotActive|FeeRecipientNotAllowed|FeeRecipientCannotBeZeroAddress|IncorrectPayment|MintQuantityExceeds\w+|PayerNotAllowed)\b/,
  );
  if (named) return named[1];
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/\s+/g, " ").slice(0, 180);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("could not bind a local port"));
        return;
      }
      const port = addr.port;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on("error", reject);
  });
}

function startAnvil(forkUrl: string, chainId: number, port: number): ChildProcess {
  const extra = join(homedir(), ".foundry", "bin");
  const path = `${extra}${delimiter}${process.env.PATH ?? ""}`;
  const bin = process.env.ANVIL_BIN || "anvil";
  const child = spawn(
    bin,
    ["--fork-url", forkUrl, "--chain-id", String(chainId), "--port", String(port), "--accounts", "0"],
    { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PATH: path } },
  );
  child.stdout?.resume();
  child.stderr?.resume();
  return child;
}

async function waitForRpc(url: string, timeoutMs = 45_000): Promise<void> {
  const client = createPublicClient({ transport: http(url) });
  const start = Date.now();
  for (;;) {
    try {
      await client.getBlockNumber();
      return;
    } catch {
      if (Date.now() - start > timeoutMs) throw new Error(`anvil RPC not ready at ${url}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

function pass(name: string, detail: string): CaseResult {
  return { name, ok: true, expected: true, detail };
}
function fail(name: string, detail: string): CaseResult {
  return { name, ok: false, expected: true, detail };
}

export async function runSimulations(opts: {
  cfg: AppConfig;
  quantity: bigint;
  count: number;
  wallets?: LoadedWallet[];
}): Promise<CaseResult[]> {
  const { cfg, quantity } = opts;
  const live = createPublicClient({
    chain: makeChain(cfg),
    transport: http(cfg.rpcUrl, { timeout: 20_000 }),
  });

  const [col, drop, fee, block] = await Promise.all([
    readCollection(live, cfg),
    readPublicDrop(live, cfg),
    readFeeRecipient(live, cfg),
    live.getBlock(),
  ]);
  const now = Number(block.timestamp);
  const window = publicWindow(drop, now);

  console.log("=== live chain (read-only) ===");
  console.log(`${col.name} (${col.symbol})  ${col.totalSupply}/${col.maxSupply}`);
  console.log(`price ${formatEther(drop.mintPrice)} ETH  max/wallet ${drop.maxTotalMintableByWallet}`);
  console.log(`public ${new Date(drop.startTime * 1000).toISOString()} -> ${new Date(drop.endTime * 1000).toISOString()}`);
  console.log(`window ${window.live ? "LIVE" : window.upcoming ? "upcoming" : window.ended ? "ended" : "unset"}`);
  console.log(`fee recipient ${fee}`);

  const data = encodeMintPublic(fee, quantity, cfg);
  const liveResults = await liveCallCases(live, cfg, fee, drop.mintPrice, quantity, data);

  console.log("\n=== fork (anvil) ===");
  let forkResults: CaseResult[];
  try {
    forkResults = await forkCases(cfg, fee, drop, quantity, opts.count, opts.wallets);
  } catch (err) {
    forkResults = [fail("fork", err instanceof Error ? err.message : String(err))];
    console.log(`SKIP fork  ${forkResults[0].detail}`);
  }

  return [...liveResults, ...forkResults];
}

async function liveCallCases(
  client: ReturnType<typeof createPublicClient>,
  cfg: AppConfig,
  fee: Address,
  price: bigint,
  quantity: bigint,
  data: Hex,
): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  const from = "0x0000000000000000000000000000000000000001" as Address;

  const tooEarly = await client
    .call({
      account: from,
      to: cfg.seaDropAddress,
      data,
      value: price * quantity,
    })
    .then(() => fail("live eth_call before start", "call succeeded (unexpected)"))
    .catch((err) => {
      const reason = decodeRevert(err);
      const ok = /NotActive|reverted|execution reverted/i.test(reason);
      return {
        name: "live eth_call before start",
        ok,
        expected: true,
        detail: ok ? `reverts before start as expected (${reason})` : `unexpected: ${reason}`,
      };
    });
  results.push(tooEarly);
  console.log(`${tooEarly.ok ? "PASS" : "FAIL"}  ${tooEarly.name}  ${tooEarly.detail}`);

  const encodeOk =
    data.startsWith("0x") && data.length > 10
      ? pass("encode mintPublic", `${data.slice(0, 10)}... ${data.length / 2 - 1} bytes  value=${formatEther(price * quantity)} ETH`)
      : fail("encode mintPublic", "empty calldata");
  results.push(encodeOk);
  console.log(`${encodeOk.ok ? "PASS" : "FAIL"}  ${encodeOk.name}  ${encodeOk.detail}`);

  const feeOk = fee !== zeroAddress ? pass("fee recipient", fee) : fail("fee recipient", "zero address");
  results.push(feeOk);
  console.log(`${feeOk.ok ? "PASS" : "FAIL"}  ${feeOk.name}  ${feeOk.detail}`);

  return results;
}

async function forkCases(
  liveCfg: AppConfig,
  fee: Address,
  drop: Awaited<ReturnType<typeof readPublicDrop>>,
  quantity: bigint,
  count: number,
  existing?: LoadedWallet[],
): Promise<CaseResult[]> {
  const port = await freePort();
  const rpc = `http://127.0.0.1:${port}`;
  const anvil = startAnvil(liveCfg.rpcUrl, liveCfg.chainId, port);
  const results: CaseResult[] = [];
  const earlyExit = new Promise<never>((_, reject) => {
    anvil.once("error", (err) => reject(new Error(`could not launch anvil: ${err.message}`)));
    anvil.once("exit", (code) => reject(new Error(`anvil exited early (code ${code}). Is Foundry installed and is the RPC forkable?`)));
  });
  try {
    await Promise.race([waitForRpc(rpc), earlyExit]);
    const chain = makeChain({ ...liveCfg, rpcUrl: rpc });
    const test = createTestClient({
      chain,
      mode: "anvil",
      transport: http(rpc, { timeout: 30_000 }),
    })
      .extend(publicActions)
      .extend(walletActions);

    const wallets = existing && existing.length > 0 ? existing.slice(0, Math.max(count, 3)) : generateWallets(Math.max(count, 3));
    const [a, b, c] = wallets;
    const fundAmount = drop.mintPrice * quantity + parseEther("0.01");

    await test.setBalance({ address: a.address, value: fundAmount });
    await test.setBalance({ address: b.address, value: fundAmount });
    await test.setBalance({ address: c.address, value: 0n });

    const mint = async (wallet: LoadedWallet, qty: bigint, value: bigint, recipient: Address) => {
      const account = privateKeyToAccount(wallet.privateKey);
      const walletClient = createWalletClient({
        account,
        chain,
        transport: http(rpc),
      });
      const tx = {
        account,
        to: liveCfg.seaDropAddress,
        data: encodeMintPublic(recipient, qty, liveCfg),
        value,
        gas: 300_000n,
      } as const;
      const hash = await walletClient.sendTransaction(tx);
      const receipt = await test.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        try {
          await test.call({
            account: wallet.address,
            to: tx.to,
            data: tx.data,
            value: tx.value,
          });
        } catch (err) {
          throw new Error(decodeRevert(err));
        }
        throw new Error("transaction reverted");
      }
      return receipt;
    };

    // 1. too early
    try {
      await mint(a, quantity, drop.mintPrice * quantity, fee);
      results.push(fail("fork too-early mint", "tx succeeded before startTime"));
    } catch (err) {
      const reason = decodeRevert(err);
      results.push(
        /NotActive/i.test(reason)
          ? pass("fork too-early mint", reason)
          : fail("fork too-early mint", reason),
      );
    }

    await test.setNextBlockTimestamp({ timestamp: BigInt(drop.startTime) });
    await test.mine({ blocks: 1 });

    // 2. happy path wallet A
    try {
      const receipt = await mint(a, quantity, drop.mintPrice * quantity, fee);
      const minted = await alreadyMinted(test, a.address, liveCfg);
      const ok = receipt.status === "success" && minted >= quantity;
      results.push(
        ok
          ? pass("fork happy-path mint", `status=${receipt.status} gas=${receipt.gasUsed} minted=${minted}`)
          : fail("fork happy-path mint", `status=${receipt.status} minted=${minted}`),
      );
    } catch (err) {
      results.push(fail("fork happy-path mint", decodeRevert(err)));
    }

    // 3. double mint
    try {
      await mint(a, quantity, drop.mintPrice * quantity, fee);
      results.push(fail("fork already-minted", "second mint succeeded"));
    } catch (err) {
      const reason = decodeRevert(err);
      results.push(
        /MaxMintedPerWallet/i.test(reason)
          ? pass("fork already-minted", reason)
          : fail("fork already-minted", reason),
      );
    }

    // 4. underfunded
    try {
      await mint(c, quantity, drop.mintPrice * quantity, fee);
      results.push(fail("fork underfunded", "unfunded wallet minted"));
    } catch (err) {
      results.push(pass("fork underfunded", decodeRevert(err)));
    }

    // 5. qty above cap
    await test.setBalance({ address: b.address, value: fundAmount * 5n });
    try {
      const over = BigInt(drop.maxTotalMintableByWallet || 1) + 1n;
      await mint(b, over, drop.mintPrice * over, fee);
      results.push(fail("fork over-max quantity", "over-max mint succeeded"));
    } catch (err) {
      const reason = decodeRevert(err);
      results.push(
        /MaxMintedPerWallet|MaxSupply/i.test(reason)
          ? pass("fork over-max quantity", reason)
          : fail("fork over-max quantity", reason),
      );
    }

    // 6. bad fee recipient
    try {
      await mint(b, quantity, drop.mintPrice * quantity, zeroAddress);
      results.push(fail("fork bad fee recipient", "zero fee recipient accepted"));
    } catch (err) {
      const reason = decodeRevert(err);
      results.push(
        /FeeRecipient/i.test(reason)
          ? pass("fork bad fee recipient", reason)
          : fail("fork bad fee recipient", reason),
      );
    }

    // 7. second funded wallet still works
    try {
      const receipt = await mint(b, quantity, drop.mintPrice * quantity, fee);
      const minted = await alreadyMinted(test, b.address, liveCfg);
      results.push(
        receipt.status === "success" && minted >= quantity
          ? pass("fork second wallet", `minted=${minted} gas=${receipt.gasUsed}`)
          : fail("fork second wallet", `status=${receipt.status} minted=${minted}`),
      );
    } catch (err) {
      results.push(fail("fork second wallet", decodeRevert(err)));
    }

    for (const r of results) {
      console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  ${r.detail}`);
    }
    return results;
  } finally {
    anvil.removeAllListeners();
    anvil.kill("SIGTERM");
    setTimeout(() => {
      try {
        anvil.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }, 1500).unref();
  }
}

export function printSummary(results: CaseResult[]): number {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${passed} passed  ${failed} failed  ${results.length} total`);
  return failed;
}

export { shortAddr };
