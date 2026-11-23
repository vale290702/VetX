import type { HaciendaSettings } from "./index.js";

export function loadFiscalSettings(
  env: Record<string, string | undefined> = process.env,
): HaciendaSettings | undefined {
  const keys = [
    "HACIENDA_TOKEN_URL",
    "HACIENDA_RECEPTION_URL",
    "HACIENDA_CLIENT_ID",
    "HACIENDA_HTTP_TIMEOUT_MS",
    "HACIENDA_RESPONSE_BYTES",
  ];
  if (keys.every((key) => !env[key])) return undefined;
  const read = (key: string) => {
    const value = env[key]?.trim();
    if (!value) throw new Error("Missing " + key);
    return value;
  };
  const number = (key: string) => {
    const raw = read(key),
      value = Number(raw);
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(value) || value > 2147483647)
      throw new Error("Invalid " + key);
    return value;
  };
  return {
    tokenUrl: read(keys[0]!),
    receptionUrl: read(keys[1]!),
    clientId: read(keys[2]!),
    timeoutMs: number(keys[3]!),
    maxResponseBytes: number(keys[4]!),
  };
}
