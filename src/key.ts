import { copyFileSync, existsSync } from "node:fs";
import { fromRoot } from "./paths.js";
import { upsertEnvVar } from "./fsutil.js";

type KeyResponse = {
  key?: string;
  api_key?: string;
  apiKey?: string;
  data?: { key?: string; api_key?: string };
};

export async function createOpenSeaKey(): Promise<string> {
  const res = await fetch("https://api.opensea.io/api/v2/auth/keys", { method: "POST" });
  const text = await res.text();
  let body: KeyResponse = {};
  try {
    body = text ? (JSON.parse(text) as KeyResponse) : {};
  } catch {
    throw new Error(`OpenSea key request failed (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const errors = (body as { errors?: string[] }).errors;
    throw new Error(
      `OpenSea key request failed (${res.status}): ${Array.isArray(errors) ? errors.join("; ") : text.slice(0, 200)}`,
    );
  }
  const key = body.key ?? body.api_key ?? body.apiKey ?? body.data?.key ?? body.data?.api_key;
  if (!key) throw new Error(`OpenSea did not return a key. Response: ${text.slice(0, 240)}`);
  return key;
}

export function ensureEnvFile(): string {
  const dest = fromRoot(".env");
  const example = fromRoot(".env.example");
  if (!existsSync(dest) && existsSync(example)) {
    copyFileSync(example, dest);
  }
  return dest;
}

export async function saveOpenSeaKey(force: boolean): Promise<void> {
  const key = await createOpenSeaKey();
  const envPath = ensureEnvFile();
  const result = upsertEnvVar(envPath, "OPENSEA_API_KEY", key, force);
  if (result === "skipped") {
    console.log("OPENSEA_API_KEY is already set in .env. Pass --force to replace it.");
    console.log("New key (not saved):");
    console.log(key);
    return;
  }
  console.log(`Saved OpenSea API key to ${envPath}`);
  console.log("Next: npm run generate -- --count 5");
}
