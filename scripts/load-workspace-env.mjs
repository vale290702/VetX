import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const path = new URL("../.env", import.meta.url);
if (existsSync(path)) {
  const workspace = parseEnv(readFileSync(path, "utf8"));
  for (const name of ["API_INTERNAL_URL", "EXPO_PUBLIC_API_URL"]) {
    if (process.env[name] === undefined && workspace[name] !== undefined) {
      process.env[name] = workspace[name];
    }
  }
}
