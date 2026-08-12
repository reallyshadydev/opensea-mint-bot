import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";

/** Read a text file even if Notepad saved it as UTF-8 BOM or UTF-16. */
export function readTextFile(filePath: string): string {
  const buf = readFileSync(filePath);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.subarray(2).toString("utf16le");
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    throw new Error(`${filePath} looks like UTF-16 BE. Re-save it as UTF-8.`);
  }
  let text = buf.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

/** Write a secret file as UTF-8 (no BOM). On Mac/Linux, lock it to your user only. */
export function writeSecretFile(filePath: string, contents: string): void {
  writeFileSync(filePath, contents, { encoding: "utf8" });
  if (process.platform !== "win32") {
    try {
      chmodSync(filePath, 0o600);
    } catch {
      /* best-effort on unusual filesystems */
    }
  }
}

export function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}

export function upsertEnvVar(filePath: string, name: string, value: string, force: boolean): "set" | "updated" | "skipped" {
  if (!existsSync(filePath)) {
    writeSecretFile(filePath, `${name}=${value}\n`);
    return "set";
  }
  const text = readTextFile(filePath);
  const lineRe = new RegExp(`^${name}=.*$`, "m");
  const match = text.match(lineRe);
  if (!match) {
    const nl = text.endsWith("\n") || text.length === 0 ? "" : "\n";
    writeSecretFile(filePath, `${text}${nl}${name}=${value}\n`);
    return "set";
  }
  const current = match[0].slice(name.length + 1).trim();
  if (current && !force) return "skipped";
  writeSecretFile(filePath, text.replace(lineRe, `${name}=${value}`));
  return "updated";
}
