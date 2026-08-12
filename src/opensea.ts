import { env, parseAddress, type AppConfig, type CliOptions } from "./config.js";

export type DropStage = {
  uuid: string;
  label?: string;
  stage_type: string;
  start_time: string;
  end_time: string;
  price?: string;
  max_per_wallet: string;
  price_currency_address: string;
};

export type DropDetails = {
  chain: string;
  collection_name?: string;
  collection_slug: string;
  contract_address: string;
  drop_type: string;
  is_minting: boolean;
  max_supply?: string;
  total_supply?: string;
  opensea_url: string;
  stages: DropStage[];
  active_stage?: DropStage | null;
  next_stage?: DropStage | null;
};

export type BuiltMintTx = {
  chain: string;
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
};

export class OpenSeaError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

export function createOpenSea(cfg: AppConfig = env()) {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };
  if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${cfg.openseaApi}${path}`, {
      ...init,
      headers: { ...headers, ...(init?.headers ?? {}) },
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* keep raw */
    }
    if (!res.ok) {
      const errors = Array.isArray((body as { errors?: string[] })?.errors)
        ? (body as { errors: string[] }).errors.join("; ")
        : text.slice(0, 240);
      throw new OpenSeaError(`OpenSea ${res.status}: ${errors || res.statusText}`, res.status, body);
    }
    return body as T;
  }

  return {
    async getDrop(): Promise<DropDetails> {
      return request<DropDetails>(`/api/v2/drops/${cfg.slug}`);
    },

    async getContract(chain: string, address: string) {
      return request<{
        address: string;
        chain: string;
        collection: string;
        contract_standard: string;
        name: string;
      }>(`/api/v2/chain/${chain}/contract/${address}`);
    },

    async buildMint(minter: string, quantity: number): Promise<BuiltMintTx> {
      return request<BuiltMintTx>(`/api/v2/drops/${cfg.slug}/mint`, {
        method: "POST",
        body: JSON.stringify({ minter, quantity }),
      });
    },
  };
}

export async function loadConfig(opts: CliOptions): Promise<AppConfig> {
  const cfg = env({ slug: opts.slug, nft: opts.nft });
  const slugExplicit = Boolean(opts.slug || process.env.COLLECTION_SLUG);
  const nftExplicit = Boolean(opts.nft || process.env.NFT_ADDRESS);

  if (nftExplicit || !slugExplicit) return cfg;

  if (!cfg.apiKey) {
    throw new Error(
      `COLLECTION_SLUG is "${cfg.slug}" but NFT_ADDRESS is unset. ` +
        `Set NFT_ADDRESS in .env, or set OPENSEA_API_KEY so the bot can resolve the contract.`,
    );
  }

  const drop = await createOpenSea(cfg).getDrop();
  const nft = parseAddress(drop.contract_address, "OpenSea contract_address");
  console.log(`Resolved NFT ${nft} from OpenSea slug "${cfg.slug}"`);
  return { ...cfg, nftAddress: nft };
}

export function publicStage(drop: DropDetails): DropStage | undefined {
  return drop.stages.find((s) => s.stage_type === "public_sale" || /public/i.test(s.label ?? ""));
}

export function formatStage(stage: DropStage): string {
  const priceWei = stage.price ? BigInt(stage.price) : 0n;
  const eth = Number(priceWei) / 1e18;
  const price = priceWei === 0n ? "free" : `${eth} ETH`;
  return `${stage.label ?? stage.stage_type} | ${price} | ${stage.max_per_wallet}/wallet | ${stage.start_time} → ${stage.end_time}`;
}
