import { randomBytes } from "node:crypto";
import {
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  statSync,
} from "node:fs";
import { parseEnv } from "node:util";

const path = new URL("../.env", import.meta.url);
const template = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
const lock = new URL("../.env.init-lock", import.meta.url);
// Two initializations must never race to replace the signing key for active codes.
closeSync(openSync(lock, "wx", 0o600));
try {
  let text = template;
  let mode = 0o600;
  let existing = false;
  try {
    text = readFileSync(path, "utf8");
    mode = statSync(path).mode & 0o777;
    existing = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const original = text;
  const current = parseEnv(text);
  const storageSettings = new Set(["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "DOCUMENT_MAX_BYTES"]);
  for (const [key, defaultValue] of Object.entries(parseEnv(template))) {
    const value =
      key === "S3_ENDPOINT" && current.S3_PORT
        ? new URL("http://127.0.0.1:" + current.S3_PORT).origin
        : defaultValue;
    if (
      (!key.startsWith("PET_LINK_") && !storageSettings.has(key)) ||
      key in current ||
      key === "PET_LINK_HMAC_KEY_HEX"
    )
      continue;
    text += `\n${key}=${value}\n`;
  }
  if (!current.PET_LINK_HMAC_KEY_HEX) {
    const setting = `PET_LINK_HMAC_KEY_HEX=${randomBytes(32).toString("hex")}`;
    const keyLine = /^\s*(?:export\s+)?PET_LINK_HMAC_KEY_HEX\s*=.*$/m;
    text = keyLine.test(text) ? text.replace(keyLine, setting) : `${text}\n${setting}\n`;
  }
  if (!existing || original !== text) {
    const temporary = new URL(`../.env.init-${randomBytes(12).toString("hex")}`, import.meta.url);
    writeFileSync(temporary, text, { mode, flag: "wx" });
    try {
      renameSync(temporary, path);
    } catch (error) {
      unlinkSync(temporary);
      throw error;
    }
  }
} finally {
  unlinkSync(lock);
}
