import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { generateExchangeKeys } from "@vetx/exchange";
import { exchangeKeyringPath, exchangeRunDirectory } from "./exchange-run.ts";

const directory = exchangeRunDirectory();
await mkdir(directory, { mode: 0o700 });
try {
  const clinics = [],
    routes = [];
  for (const lane of [
    "api",
    "web-desktop",
    "web-mobile-dark",
    "referral-desktop",
    "referral-mobile-dark",
  ]) {
    const scopes = [];
    for (const role of ["source", "destination"]) {
      const scope = { organizationId: randomUUID(), clinicId: randomUUID() };
      const { signing, encryption } = await generateExchangeKeys(scope);
      clinics.push({
        ...scope,
        name: lane + " " + role,
        signing: [signing.privateKey],
        encryption: [encryption.privateKey],
      });
      scopes.push(scope);
    }
    const [source, destination] = scopes;
    routes.push({ source, destination });
    routes.push({ source: destination, destination: source });
  }
  const path = exchangeKeyringPath();
  await writeFile(path + ".tmp", JSON.stringify({ version: 1, clinics, routes }), {
    mode: 0o600,
    flag: "wx",
  });
  await rename(path + ".tmp", path);
} catch (error) {
  await rm(directory, { recursive: true, force: true });
  throw error;
}
