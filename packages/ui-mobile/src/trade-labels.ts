import type { Receipt, ReceivedLine } from "./trade-forms";
import type { Warehouse } from "./inventory-forms";
export async function warehouseLabels(
  ids: string[],
  load: (page: number) => Promise<{ warehouses: Warehouse[]; hasNextPage: boolean }>,
) {
  const missing = new Set(ids),
    names = new Map<string, string>();
  for (let page = 1; missing.size; page++) {
    const data = await load(page);
    for (const w of data.warehouses) if (missing.delete(w.id)) names.set(w.id, w.name);
    if (!data.hasNextPage) break;
  }
  return names;
}

export async function receiptMovements(
  ids: string[],
  load: (page: number) => Promise<{ receipts: Receipt[]; hasNextPage: boolean }>,
) {
  const missing = new Set(ids),
    lines = new Map<string, ReceivedLine>();
  for (let page = 1; missing.size; page++) {
    const data = await load(page);
    for (const r of data.receipts)
      for (const l of r.lines) if (missing.delete(l.movementId)) lines.set(l.movementId, l);
    if (!data.hasNextPage) break;
  }
  return lines;
}
