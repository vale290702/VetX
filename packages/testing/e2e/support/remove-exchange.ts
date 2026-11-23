import { rm } from "node:fs/promises";
import { exchangeRunDirectory } from "./exchange-run.ts";
export default async function removeExchange() {
  await rm(exchangeRunDirectory(), { recursive: true, force: true });
}
