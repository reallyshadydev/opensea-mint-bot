import { formatEther, parseEther, type Address } from "viem";
import { makePublicClient, makeWalletClient } from "./clients.js";
import { parseArgs, resolveWalletsFile, txUrl, walletsPath, type AppConfig } from "./config.js";
import { createOpenSea, formatStage, loadConfig } from "./opensea.js";
import {
  alreadyMinted,
  formatPublicDrop,
  publicWindow,
  readCollection,
  readFeeRecipient,
  readPublicDrop,
} from "./seadrop.js";
import {
  minBalance,
  mintAll,
  parseFundTarget,
  printOpenSeaHint,
  waitForPublicLive,
  writeResults,
} from "./snipe.js";
import { saveOpenSeaKey } from "./key.js";
import { printSummary, runSimulations } from "./simulate.js";
import { generateWallets, loadWallets, shortAddr, writeWalletsCsv } from "./wallets.js";

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.command === "generate") {
    generate(opts);
    return;
  }
  if (opts.command === "key") {
    await saveOpenSeaKey(opts.force);
    return;
  }

  const cfg = await loadConfig(opts);
  const client = makePublicClient(cfg);

  if (opts.command === "status") {
    await status(client, cfg);
    return;
  }
  if (opts.command === "simulate") {
    const wallets = opts.walletsFile ? loadWallets(resolveWalletsFile(opts.walletsFile), opts.limit) : undefined;
    if (wallets) console.log(`Loaded ${wallets.length} wallet(s) for sim`);
    const failed = printSummary(
      await runSimulations({
        cfg,
        quantity: BigInt(opts.quantity),
        count: opts.count,
        wallets,
      }),
    );
    process.exitCode = failed > 0 ? 1 : 0;
    return;
  }

  const walletsFile = resolveWalletsFile(opts.walletsFile);
  const wallets = loadWallets(walletsFile, opts.limit);
  console.log(`Loaded ${wallets.length} wallet(s) from ${walletsFile}`);

  if (opts.command === "check") {
    await checkWallets(client, cfg, wallets, BigInt(opts.quantity));
    return;
  }
  if (opts.command === "fund") {
    await fund(client, cfg, wallets, opts.dryRun || !opts.live, opts.yes);
    return;
  }
  if (opts.command === "snipe") {
    await snipe(client, cfg, wallets, opts);
  }
}

function generate(opts: ReturnType<typeof parseArgs>) {
  const path = walletsPath(opts.walletsFile);
  const created = generateWallets(opts.count);
  const { written, total } = writeWalletsCsv(path, created, {
    force: opts.force,
    append: opts.append,
  });
  console.log(`Wrote ${written.length} new wallet(s) to ${path}  (file now has ${total})`);
  for (const w of written) {
    console.log(`${w.index}  ${w.address}`);
  }
  console.log("Private keys were written to the CSV only — keep that file offline and never commit it.");
  console.log("Next: fund them (`npm run fund -- --live`) then `npm run check`.");
}

function printTarget(cfg: AppConfig) {
  console.log(`${cfg.chainName}  ·  slug=${cfg.slug}  ·  public mint bot`);
  console.log(`NFT              ${cfg.nftAddress}`);
  console.log(`SeaDrop          ${cfg.seaDropAddress}`);
  console.log(`chain            ${cfg.chainName} (${cfg.chainId})`);
  console.log(`rpc              ${cfg.rpcUrl}`);
  console.log(`explorer         ${cfg.explorerUrl}`);
}

async function status(client: ReturnType<typeof makePublicClient>, cfg: AppConfig) {
  const [col, drop, fee, block] = await Promise.all([
    readCollection(client, cfg),
    readPublicDrop(client, cfg),
    readFeeRecipient(client, cfg),
    client.getBlock(),
  ]);
  const now = Number(block.timestamp);
  const window = publicWindow(drop, now);

  printTarget(cfg);
  console.log(`collection       ${col.name} (${col.symbol})`);
  console.log(`supply           ${col.totalSupply}/${col.maxSupply}`);
  console.log(`fee recipient    ${fee}${cfg.feeRecipient ? "  (from .env)" : ""}`);
  console.log(`chain time       ${new Date(now * 1000).toISOString()}  block ${block.number}`);
  console.log("");
  console.log("On-chain public drop");
  for (const line of formatPublicDrop(drop)) console.log(`  ${line}`);
  console.log(
    `  window          ${window.live ? "LIVE" : window.upcoming ? "upcoming" : window.ended ? "ended" : "not configured"}`,
  );

  if (!cfg.apiKey) {
    console.log("\nSet OPENSEA_API_KEY to also print OpenSea stage schedule.");
    return;
  }
  try {
    const os = await createOpenSea(cfg).getDrop();
    console.log("");
    console.log(`OpenSea drop     ${os.collection_name ?? cfg.slug}  minting=${os.is_minting}`);
    console.log(`OpenSea url      ${os.opensea_url}`);
    if (os.contract_address && os.contract_address.toLowerCase() !== cfg.nftAddress.toLowerCase()) {
      console.log(
        `WARNING          OpenSea slug "${cfg.slug}" is contract ${os.contract_address}, ` +
          `but NFT_ADDRESS is ${cfg.nftAddress}. Update NFT_ADDRESS or COLLECTION_SLUG.`,
      );
    }
    for (const stage of os.stages) console.log(`  ${formatStage(stage)}`);
  } catch (err) {
    console.log(`\nOpenSea API: ${err instanceof Error ? err.message : err}`);
  }
}

async function checkWallets(
  client: ReturnType<typeof makePublicClient>,
  cfg: AppConfig,
  wallets: ReturnType<typeof loadWallets>,
  quantity: bigint,
) {
  const drop = await readPublicDrop(client, cfg);
  const need = minBalance(drop.mintPrice, quantity, cfg.gasBufferWei);
  console.log(
    `Need ≥ ${formatEther(need)} ${cfg.nativeSymbol}/wallet  (mint ${formatEther(drop.mintPrice * quantity)} + gas buffer ${formatEther(cfg.gasBufferWei)})`,
  );

  let ready = 0;
  let already = 0;
  let short = 0;

  for (const w of wallets) {
    const [bal, minted] = await Promise.all([
      client.getBalance({ address: w.address }),
      alreadyMinted(client, w.address, cfg),
    ]);
    if (minted > 0n) {
      already += 1;
      console.log(`ALREADY  ${w.index} ${shortAddr(w.address)}  minted=${minted}`);
      continue;
    }
    if (bal < need) {
      short += 1;
      console.log(`SHORT    ${w.index} ${shortAddr(w.address)}  ${formatEther(bal)} ${cfg.nativeSymbol}`);
      continue;
    }
    ready += 1;
    console.log(`READY    ${w.index} ${shortAddr(w.address)}  ${formatEther(bal)} ${cfg.nativeSymbol}`);
  }

  console.log(`\nready=${ready}  short=${short}  already=${already}`);
  if (short > 0) {
    console.log("Top up short wallets, then: npm run fund -- --live   (or send ETH yourself)");
    process.exitCode = 1;
  }
}

async function fund(
  client: ReturnType<typeof makePublicClient>,
  cfg: AppConfig,
  wallets: ReturnType<typeof loadWallets>,
  dryRun: boolean,
  yes: boolean,
) {
  if (!cfg.fundingKey) throw new Error("Set FUNDING_PRIVATE_KEY in .env");

  const target = parseFundTarget(cfg);
  const funder = makeWalletClient(cfg.fundingKey, cfg);
  const from = funder.account!.address;
  const funderBal = await client.getBalance({ address: from });
  console.log(
    `Funding wallet ${from}  balance ${formatEther(funderBal)} ${cfg.nativeSymbol}  target ${formatEther(target)} ${cfg.nativeSymbol}/wallet`,
  );

  const plans: { to: Address; amount: bigint; index: number }[] = [];
  for (const w of wallets) {
    const bal = await client.getBalance({ address: w.address });
    if (bal >= target) continue;
    plans.push({ to: w.address, amount: target - bal, index: w.index });
  }

  const total = plans.reduce((a, p) => a + p.amount, 0n);
  console.log(`${plans.length} wallet(s) need ${formatEther(total)} ${cfg.nativeSymbol} total`);
  if (plans.length === 0) return;
  if (funderBal <= total + parseEther("0.0002")) {
    throw new Error("Funding wallet does not have enough ETH");
  }
  if (dryRun) {
    for (const p of plans) {
      console.log(`DRY  +${formatEther(p.amount)} ${cfg.nativeSymbol} → ${p.index} ${shortAddr(p.to)}`);
    }
    console.log("Re-run with --live to send.");
    return;
  }
  if (!yes) {
    console.log("Sending in 5s. Ctrl+C to abort, or pass --yes.");
    await new Promise((r) => setTimeout(r, 5_000));
  }

  for (const p of plans) {
    const hash = await funder.sendTransaction({
      chain: funder.chain,
      account: funder.account!,
      to: p.to,
      value: p.amount,
    });
    console.log(
      `SENT  +${formatEther(p.amount)} ${cfg.nativeSymbol} → ${p.index} ${shortAddr(p.to)}  ${txUrl(hash, cfg.explorerUrl)}`,
    );
  }
}

async function snipe(
  client: ReturnType<typeof makePublicClient>,
  cfg: AppConfig,
  wallets: ReturnType<typeof loadWallets>,
  opts: ReturnType<typeof parseArgs>,
) {
  if (opts.quantity < 1) throw new Error("quantity must be >= 1");
  if (opts.mode !== "seadrop" && opts.mode !== "opensea") {
    throw new Error("mode must be seadrop or opensea");
  }

  const drop = await readPublicDrop(client, cfg);
  if (opts.quantity > drop.maxTotalMintableByWallet && drop.maxTotalMintableByWallet > 0) {
    throw new Error(
      `quantity ${opts.quantity} exceeds on-chain max per wallet (${drop.maxTotalMintableByWallet})`,
    );
  }

  const willSend = !opts.dryRun;

  printTarget(cfg);
  console.log(`Mode            ${opts.mode}`);
  console.log(`Wallets         ${wallets.length}`);
  console.log(`Quantity        ${opts.quantity}`);
  console.log(`Mint price      ${formatEther(drop.mintPrice)} ${cfg.nativeSymbol}`);
  console.log(`Public start    ${drop.startTime ? new Date(drop.startTime * 1000).toISOString() : "(not set)"}`);
  console.log(`Dry run         ${!willSend}`);
  await printOpenSeaHint(cfg);

  if (!opts.yes) {
    console.log("\nArming in 5s. Ctrl+C to abort, or pass --yes.");
    await new Promise((r) => setTimeout(r, 5_000));
  }

  if (!willSend) {
    console.log("Dry run — will not send transactions.");
  }

  await waitForPublicLive(client, cfg);
  const results = await mintAll({
    client,
    wallets,
    quantity: BigInt(opts.quantity),
    mode: opts.mode,
    dryRun: !willSend,
    cfg,
  });
  writeResults(results);

  const sent = results.filter((r) => r.hash);
  if (sent.length > 0) {
    console.log("Waiting for receipts...");
    for (const r of sent) {
      if (!r.hash) continue;
      try {
        const receipt = await client.waitForTransactionReceipt({ hash: r.hash, timeout: 60_000 });
        console.log(
          `${receipt.status === "success" ? "OK  " : "REVERT"}  ${shortAddr(r.wallet)}  block ${receipt.blockNumber}`,
        );
      } catch (err) {
        console.log(`WAIT  ${shortAddr(r.wallet)}  ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
