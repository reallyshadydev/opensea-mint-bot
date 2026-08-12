# OpenSea mint bot

A small program that **mints an NFT the second a public sale opens**, from one wallet or many.

You do not need to write any code. You paste a few commands, fill in a settings file, and let it wait.

Works on **Windows**, **macOS**, and **Linux**. It is set up for **[HoodBirds](https://opensea.io/collection/hoodbirdss)** on **Robinhood Chain** out of the box. Change two lines later and you can use it on the next drop.

Want buttons instead of Terminal? Use the local web UI: **[opensea-mint-ui](https://github.com/reallyshadydev/opensea-mint-ui)**.

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

- **Windows 10+**, **macOS**, or **Linux**
- [Node.js 20 or newer](https://nodejs.org) — the **LTS** button. After installing, close and reopen your terminal, then run `node -v`. You want `v20` or higher.
- A little **ETH on Robinhood Chain** (HoodBirds public is **0.001 ETH per wallet**, plus a tiny bit extra for gas)
- About 10 minutes the first time

You do **not** need to know how to code.

---

## Open a terminal

| Computer | How |
|---|---|
| **Windows** | Click Start, type `PowerShell` or `Command Prompt`, press Enter. Windows Terminal is also fine. |
| **macOS** | Press Cmd+Space, type `Terminal`, press Enter. |
| **Linux** | Open Terminal from your app menu, or press Ctrl+Alt+T. |

Every command below is the same on all three, except where a tab says otherwise.

---

## 10-minute setup

### 1. Get the project and install it

```bash
git clone https://github.com/reallyshadydev/opensea-mint-bot.git
cd opensea-mint-bot
npm install
```

Already have the folder (no git)? Open a terminal **in that folder** and just run `npm install`.

On Windows Explorer you can Shift+right-click the folder → **Open in Terminal**.

Optional one-shot installers:

- Windows: double-click `scripts\setup.cmd`, or in PowerShell run `.\scripts\setup.cmd`
- macOS / Linux: `bash scripts/setup.sh`

### 2. Make your settings file

**Windows (Command Prompt or PowerShell):**

```bat
copy .env.example .env
```

**macOS / Linux:**

```bash
cp .env.example .env
```

That copies a template to a private file named `.env`. You will edit `.env` — never the example.

### 3. Get a free OpenSea key

This works on every OS (you do not need `curl`):

```bash
npm run key
```

It asks OpenSea for a key and writes it into `.env` for you.

If a key is already there and you want a new one:

```bash
npm run key -- --force
```

### 4. Make wallets

```bash
npm run generate -- --count 5
```

That creates **5 new wallets** and saves them in `wallets.csv` on your computer.

- The terminal prints the **addresses** (safe to share — this is where ETH and NFTs go).
- The **private keys** stay in `wallets.csv` only. That file is the keys to the money. Do not email it, screenshot it, or put it on Google Drive / iCloud / OneDrive.

Want more later without deleting the first ones?

```bash
npm run generate -- --count 10 --append
```

Already have wallets? Put them in `wallets.csv` with this header:

```text
index,address,private_key
```

If you edit the file in Notepad, use **Save as** → encoding **UTF-8** (not “Unicode”).

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

Start this **before** the public sale. Leave the window open, and stop the computer from sleeping.

| Computer | Keep it awake |
|---|---|
| **Windows** | Settings → System → Power → Screen and sleep → set to Never while plugged in |
| **macOS** | System Settings → Lock Screen / Battery → turn off sleep while plugged in |
| **Linux** | Disable suspend in your power settings, or run `caffeinate`/`systemd-inhibit` if you have it |

```bash
npm run snipe -- --yes
```

The bot will:

- sit there and print a countdown
- mint from every `READY` wallet the instant public opens
- write a report to `results.json`

Practice without spending anything:

```bash
npm run simulate
npm run snipe -- --dry-run --yes
```

`simulate` forks the live chain on your machine, jumps to public start, and tries mints (too early, happy path, already minted, broke wallet, too many). No real ETH is spent. Needs [Foundry](https://getfoundry.sh) (`anvil`).

That does the full wait, then pretends to mint.

To stop it, press **Ctrl+C** (same on Windows, Mac, and Linux).

---

## The only commands you will use

The `--` in the middle is required. It tells npm “the rest is for the bot, not for npm.”

| Command | What it means |
|---|---|
| `npm run key` | Get an OpenSea API key and save it |
| `npm run generate -- --count 5` | Make 5 new wallets |
| `npm run generate -- --count 10 --append` | Make 10 more, keep the old ones |
| `npm run status` | “What are we minting, and when?” |
| `npm run check` | “Do my wallets have enough ETH?” |
| `npm run fund` | Preview topping wallets up |
| `npm run fund -- --live` | Actually send ETH to them |
| `npm run snipe -- --yes` | Wait, then mint for real |
| `npm run snipe -- --dry-run --yes` | Rehearsal, no money spent |
| `npm run simulate` | Fork the chain and run fake mints |

---

## Use it on a different collection

You do not need a new app. Open `.env` and change the collection lines.

How to open `.env`:

| Computer | How |
|---|---|
| **Windows** | `notepad .env` |
| **macOS** | `open -e .env` |
| **Linux** | `nano .env` or open it in your text editor |

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

- `wallets.csv` and `.env` are **secret**. The project is set up so git will not upload them. Do not copy them into Discord, iCloud, OneDrive, or a public GitHub repo.
- Only use wallets **you** created or already own.
- Start with `--count 1` and `--dry-run` the first time.
- `QUANTITY=1` is correct for HoodBirds (1 per wallet). If you set this higher than the drop allows, the mint fails and you still pay gas.
- This bot only calls the public mint. It does not bypass allowlists.

---

## If something looks wrong

| You see this | What it means | What to do |
|---|---|---|
| `node` is not recognized / command not found | Node.js is not installed, or the terminal was not restarted | Install Node 20+ from nodejs.org, then close and reopen the terminal |
| `Wallet file not found` | You have not made wallets yet | `npm run generate -- --count 5` |
| `already exists. Pass --force` | `wallets.csv` is already there | Use `--append` to add more, or `--force` to replace (this deletes the old keys) |
| `SHORT` | That wallet is low on ETH | Send more, or run `fund -- --live` |
| `ALREADY` | That wallet already minted | Leave it; the bot will skip it |
| `NotActive` / revert | Mint was not open yet | Start `snipe` again after it opens |
| Sold out / `MaxSupply` | They are gone | Stop. Do not keep retrying. |
| OpenSea `409` | OpenSea says the drop is not live | Normal before start. The default mint path does not need OpenSea to fire. |
| OpenSea `422` | That wallet cannot mint | Check allowlist / balance / already minted |
| The name in `status` is not the drop you wanted | `.env` still points at the old collection | Fix `COLLECTION_SLUG` and `NFT_ADDRESS` |
| Weird characters or a key that will not load | The file was saved as “Unicode” in Notepad | Save again as **UTF-8** |
| Execution policy error on `setup.ps1` | Windows blocked the script | Use `scripts\setup.cmd` instead |

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
| Terminal | The text window where you type commands (PowerShell, Command Prompt, Terminal.app, etc.). |

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
