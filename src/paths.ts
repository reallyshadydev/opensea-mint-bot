import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Folder that contains package.json — or MINT_ROOT when another app (the UI) hosts the bot. */
export const PROJECT_ROOT = process.env.MINT_ROOT
  ? resolve(process.env.MINT_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function fromRoot(...parts: string[]): string {
  return join(PROJECT_ROOT, ...parts);
}

/** Relative paths are resolved from the project folder, not the current shell folder. */
export function resolveProjectPath(input?: string, fallback = "wallets.csv"): string {
  const raw = (input && input.trim()) || fallback;
  if (isAbsolute(raw)) return raw;
  return resolve(PROJECT_ROOT, raw);
}
