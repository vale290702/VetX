export interface WarehouseInput {
  name: string;
  revision: number;
}
export interface Warehouse extends WarehouseInput {
  id: string;
}
export interface StockItemInput extends WarehouseInput {
  sku: string;
  unit: string;
}
export interface StockItem extends StockItemInput {
  id: string;
}
export const movementKinds = [
  "RECEIPT",
  "ISSUE",
  "RETURN",
  "TRANSFER",
  "ADJUST_IN",
  "ADJUST_OUT",
] as const;
export interface StockMovementInput {
  itemId: string;
  kind: (typeof movementKinds)[number];
  fromWarehouseId: string | null;
  toWarehouseId: string | null;
  quantity: string;
  lot: string;
  reason: string;
}
export interface StockMovement extends StockMovementInput {
  id: string;
  fromBalance: string | null;
  toBalance: string | null;
  recordedAt: string;
  actor: { issuer: string; subject: string };
}
export interface StockBalance {
  warehouseId: string;
  warehouseName: string;
  itemId: string;
  itemName: string;
  sku: string;
  unit: string;
  lot: string;
  quantity: string;
}
export interface InventoryPage {
  page: number;
  hasNextPage: boolean;
}

export interface WarehousePage extends InventoryPage {
  warehouses: Warehouse[];
}
export interface StockItemPage extends InventoryPage {
  items: StockItem[];
}
export interface StockBalancePage extends InventoryPage {
  balances: StockBalance[];
}
export interface StockMovementPage extends InventoryPage {
  movements: StockMovement[];
}
