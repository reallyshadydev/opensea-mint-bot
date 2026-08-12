# OpenSea mint bot

A small program that **mints an NFT the second a public sale opens**, from one wallet or many.

You do not need to write any code. You copy a few commands into Terminal, fill in a settings file, and let it wait.

It is set up for **[HoodBirds](https://opensea.io/collection/hoodbirdss)** on **Robinhood Chain** out of the box. Change two lines later and you can use it on the next drop.

---

## What it does, in plain English

1. You create some wallets (or use ones you already have).
2. You put a little ETH in each wallet (enough for the mint + a tiny gas fee).
3. You start the bot **before** the public sale.
4. It watches the blockchain clock.
5. The moment public mint is live, it mints from every ready wallet at once.

It only mints the **public** stage. It will not sneak onto an allowlist or skip the mint price.

---

## What you need

- A Mac (this guide assumes that)
- [Node.js 20 or newer](https://nodejs.org) — if you are not sure, open Terminal and run `node -v`. You want `v20` or higher.
- A little **ETH on Robinhood Chain** (HoodBirds public is **0.001 ETH per wallet**, plus a tiny bit extra for gas)
- About 10 minutes the first time

You do **not** need to know how to code.

---

## 10-minute setup

Open **Terminal** (Spotlight → type `Terminal` → Enter). Then paste these one at a time.

### 1. Go into the project and install it

```bash
cd ~/hoodbirds-mint-bot
npm install
```

If you cloned this from GitHub instead:

```bash
git clone <this-repo-url>
cd hoodbirds-mint-bot
npm install
```

### 2. Make your settings file

```bash
cp .env.example .env
```

That copies a template to a private file named `.env`. You will edit `.env` — never the example.

### 3. Get a free OpenSea key

```bash
curl -X POST https://api.opensea.io/api/v2/auth/keys
```

You will get a short block of text with a `key` in it. Open `.env` in any text editor and paste that key after `OPENSEA_API_KEY=`, like:

```bash
OPENSEA_API_KEY=abc123_your_key_here
```

Save the file.

### 4. Make wallets

```bash
npm run generate -- --count 5
```

That creates **5 new wallets** and saves them in `wallets.csv` on your computer.

- The terminal prints the **addresses** (safe to share — this is where ETH and NFTs go).
- The **private keys** stay in `wallets.csv` only. That file is the keys to the money. Do not email it, screenshot it, or put it on Google Drive.

Want more later without deleting the first ones?

```bash
npm run generate -- --count 10 --append
```

Already have wallets? Put them in `wallets.csv` with this header:

```text
index,address,private_key
```

### 5. See what you are about to mint

```bash
npm run status
```

You should see the collection name, the price, how many are left, and when public starts. If that looks wrong, stop and fix `.env` before you send any money.

---

## Put money in the wallets

Each HoodBirds public mint costs **0.001 ETH**. Send about **0.0012 ETH** per wallet so gas is covered.

### Option A — send from your normal wallet

Copy each address from `wallets.csv` (or from the `generate` output) and send 0.0012 ETH to it on **Robinhood Chain** (chain ID `4663`).

### Option B — let the bot spread funds for you

1. Put the private key of a wallet that already has enough ETH into `.env`:

```bash
FUNDING_PRIVATE_KEY=0xyour_funding_wallet_private_key
```

2. Preview (does not send):

```bash
npm run fund
```

3. If the amounts look right, actually send:

```bash
npm run fund -- --live
```

### Double-check before mint day

```bash
npm run check
```

You want every wallet to say `READY`. `SHORT` means it needs more ETH. `ALREADY` means that wallet already minted.

---

## Mint day

Start this **before** the public sale. Leave the window open.

```bash
npm run snipe -- --yes
```

The bot will:

- sit there and print a countdown
- mint from every `READY` wallet the instant public opens
- write a report to `results.json`

Practice without spending anything:

```bash
npm run snipe -- --dry-run --yes
```

That does the full wait, then pretends to mint.

---

## The only commands you will use

| Command | What it means |
|---|---|
| `npm run generate -- --count 5` | Make 5 new wallets |
| `npm run generate -- --count 10 --append` | Make 10 more, keep the old ones |
| `npm run status` | “What are we minting, and when?” |
| `npm run check` | “Do my wallets have enough ETH?” |
| `npm run fund` | Preview topping wallets up |
| `npm run fund -- --live` | Actually send ETH to them |
| `npm run snipe -- --yes` | Wait, then mint for real |
| `npm run snipe -- --dry-run --yes` | Rehearsal, no money spent |

---

## Use it on a different collection

You do not need a new app. Open `.env` and change the collection lines.

**Same chain (Robinhood), new drop:**

```bash
COLLECTION_SLUG=the-new-drop
NFT_ADDRESS=0xTheNftContract
```

The slug is the end of the OpenSea URL: `opensea.io/collection/the-new-drop`.

If you set `COLLECTION_SLUG` and your OpenSea key, you can leave `NFT_ADDRESS` blank and the bot will look the contract up.

**A different chain** (example: Base):

```bash
COLLECTION_SLUG=some-base-drop
NFT_ADDRESS=0x...
CHAIN_ID=8453
CHAIN_NAME=Base
RPC_URL=https://mainnet.base.org
EXPLORER_URL=https://basescan.org
OPENSEA_CHAIN=base
```

Then run `npm run status` and read it carefully before you fund or snipe.

One-off, without editing the file:

```bash
npm run status -- --slug other-drop --nft 0x...
```

---

## How much does this cost?

Whatever the **public mint price** is, times the number of wallets, plus a tiny gas fee on each one.

HoodBirds public is **0.001 ETH each**. Five wallets ≈ **0.005 ETH** in mint payments. Gas on Robinhood Chain is usually less than a cent.

`npm run status` always shows the live price. Change `FUND_TARGET_ETH` in `.env` if the next drop is more expensive (for example `0.011` if the mint is 0.01 ETH).

---

## Keep your money safe

- `wallets.csv` and `.env` are **secret**. The project is set up so git will not upload them. Do not copy them into Discord, iCloud screenshots, or a public GitHub repo.
- Only use wallets **you** created or already own.
- Start with `--count 1` and `--dry-run` the first time.
- `QUANTITY=1` is correct for HoodBirds (1 per wallet). If you set this higher than the drop allows, the mint fails and you still pay gas.
- This bot only calls the public mint. It does not bypass allowlists.

---

## If something looks wrong

| You see this | What it means | What to do |
|---|---|---|
| `Wallet file not found` | You have not made wallets yet | `npm run generate -- --count 5` |
| `already exists. Pass --force` | `wallets.csv` is already there | Use `--append` to add more, or `--force` to replace (this deletes the old keys) |
| `SHORT` | That wallet is low on ETH | Send more, or run `fund -- --live` |
| `ALREADY` | That wallet already minted | Leave it; the bot will skip it |
| `NotActive` / revert | Mint was not open yet | Start `snipe` again after it opens |
| Sold out / `MaxSupply` | They are gone | Stop. Do not keep retrying. |
| OpenSea `409` | OpenSea says the drop is not live | Normal before start. The default mint path does not need OpenSea to fire. |
| OpenSea `422` | That wallet cannot mint | Check allowlist / balance / already minted |
| The name in `status` is not the drop you wanted | `.env` still points at the old collection | Fix `COLLECTION_SLUG` and `NFT_ADDRESS` |

---

## Extra flags (when you are comfortable)

```bash
npm run snipe -- --limit 2 --yes          # only the first 2 wallets
npm run snipe -- --mode opensea --yes     # ask OpenSea to build the mint tx
npm run generate -- --wallets ./alt.csv --count 3
```

`--mode opensea` is the official OpenSea path. Fine for 1–2 wallets. For a lot of wallets at once, leave the default (`seadrop`) — it is faster and will not get rate-limited.

---

## Words you might not know

| Word | Meaning |
|---|---|
| Wallet | An address that can hold ETH and NFTs. Comes with a secret private key. |
| Private key | The password to a wallet. Anyone with it can take the funds. |
| ETH | The money used to pay for the mint and for network fees. |
| Gas | The small network fee for sending a transaction. |
| Slug | The collection’s name in the OpenSea URL. |
| Public sale | The open mint anyone can join, after allowlists. |
| RPC | The internet address the bot uses to talk to the blockchain. |
| SeaDrop | OpenSea’s standard minting contract. Most of their drops use it. |

---

## Defaults (HoodBirds)

| | |
|---|---|
| Collection | [HoodBirds](https://opensea.io/collection/hoodbirdss) |
| Chain | Robinhood Chain (`4663`) |
| Public price | 0.001 ETH |
| Limit | 1 per wallet |
| Public start | 13 Aug 2026, 19:30 UTC |

Confirm these with `npm run status` before you send funds — the project owner can change the on-chain times.
