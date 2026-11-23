import { tmpdir } from "node:os";
import { join } from "node:path";

export function exchangeRunDirectory() {
  const id = process.env.VETX_E2E_EXCHANGE_RUN;
  if (!id || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id))
    throw new Error("Missing test exchange run ID");
  return join(tmpdir(), "vetx-playwright-exchange-" + id);
}
export function exchangeKeyringPath() {
  return join(exchangeRunDirectory(), "keyring.json");
}
