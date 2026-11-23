import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Field, Action } from "./controls";
import { usePatientAction, PatientNotice } from "./patient-controls";
import type { ClinicPatientProps } from "./patient-form";
import { InventoryAccessLost } from "./inventory-lists";
import { inventoryWrite } from "./inventory-client";
import {
  catalogInput,
  preserveAttempt,
  type Warehouse,
  type Item,
  type ItemInput,
  type WarehouseInput,
  type Attempt,
} from "./inventory-forms";
type Target = { kind: "item"; item?: Item } | { kind: "warehouse"; warehouse?: Warehouse };
export type CatalogTarget = Target;
export function CatalogEditor({
  target,
  back,
  saved,
  scope,
  client,
  account,
  styles,
}: ClinicPatientProps & { target: Target; back: () => void; saved: () => void }) {
  const { t } = useTranslation();
  const item = target.kind === "item" ? target.item : undefined,
    existing = target.kind === "item" ? target.item : target.warehouse;
  const [id] = useState(() => existing?.id ?? globalThis.expo.uuidv4());
  const [name, setName] = useState(existing?.name ?? ""),
    [sku, setSku] = useState(item?.sku ?? ""),
    [unit, setUnit] = useState(item?.unit ?? "");
  const [pending, setPending] = useState<Attempt<ItemInput | WarehouseInput>>(),
    [failure, setFailure] = useState<"denied" | "conflict" | "invalid">();
  const action = usePatientAction(account),
    locked = !!pending || action.busy;
  const catalogUnit = item?.unitLocked ? item.unit : unit;
  const reviewedUnit = pending && "unit" in pending.body ? pending.body.unit : catalogUnit;
  const fields = { name, sku, unit: reviewedUnit, revision: existing?.revision ?? 0 };
  const body =
    target.kind === "item" ? catalogInput("item", fields) : catalogInput("warehouse", fields);
  const modified =
    !existing ||
    name.trim() !== existing.name ||
    (item && (sku.trim() !== item.sku || reviewedUnit.trim() !== item.unit));
  function submit() {
    if (!body) return;
    const attempt = preserveAttempt<ItemInput | WarehouseInput>(pending, id, body);
    setPending(attempt);
    setFailure(undefined);
    void action.run(
      () =>
        inventoryWrite(async () => {
          if ("sku" in attempt.body)
            await client.inventory.saveItem(scope, attempt.id, attempt.body);
          else await client.inventory.saveWarehouse(scope, attempt.id, attempt.body);
        }),
      (result) => {
        if ("issue" in result && result.issue) {
          setFailure(result.issue);
          setPending(undefined);
        } else saved();
      },
    );
  }
  if (failure === "denied") return <InventoryAccessLost styles={styles} back={back} />;
  return (
    <View style={styles.section}>
      <Action
        styles={styles}
        disabled={action.busy}
        label={t("nativeInventory.backCatalog")}
        onPress={back}
      />
      <Text style={styles.heading} accessibilityRole="header">
        {t(
          target.kind === "item"
            ? existing
              ? "nativeInventory.editItem"
              : "nativeInventory.newItem"
            : existing
              ? "nativeInventory.editWarehouse"
              : "nativeInventory.newWarehouse",
        )}
      </Text>
      <Field
        styles={styles}
        label={t("nativeInventory.name")}
        value={name}
        onChange={setName}
        maxLength={120}
        disabled={locked}
      />
      {target.kind === "item" && (
        <>
          <Field
            styles={styles}
            label={t("nativeInventory.sku")}
            value={sku}
            onChange={setSku}
            maxLength={80}
            identifier
            disabled={locked}
          />
          <Field
            styles={styles}
            label={t("nativeInventory.unit")}
            value={reviewedUnit}
            onChange={setUnit}
            maxLength={40}
            disabled={locked || !!item?.unitLocked}
          />
          <Text style={styles.support}>
            {t(item?.unitLocked ? "nativeInventory.unitLocked" : "nativeInventory.unitHelp")}
          </Text>
        </>
      )}
      <PatientNotice styles={styles} error={action.error} />
      {pending && action.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t("nativeInventory.uncertainCatalog")}
        </Text>
      )}
      {failure && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t(
            failure === "conflict" ? "nativeInventory.catalogConflict" : "nativeInventory.invalid",
          )}
        </Text>
      )}
      <Action
        styles={styles}
        primary
        busy={action.busy}
        disabled={!body || (!pending && !modified) || failure === "conflict"}
        label={t(pending && action.error ? "nativeInventory.retrySave" : "directory.save")}
        onPress={submit}
      />
    </View>
  );
}
