import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Action } from "./controls";
import { CatalogEditor, type CatalogTarget } from "./inventory-catalog";
import { InventoryLedger } from "./inventory-ledger";
import { Balances, Items, Warehouses } from "./inventory-lists";
import { MovementEditor, type MovementItem } from "./inventory-movement";
import { displayQuantity, type Balance, type Warehouse } from "./inventory-forms";
import type { ClinicPatientProps } from "./patient-form";
type ViewName = "items" | "warehouses" | "ledger";
type Route =
  | { kind: "balances"; warehouse: Warehouse }
  | { kind: "catalog"; target: CatalogTarget }
  | { kind: "movement"; item: MovementItem; seed?: Balance };
export function ClinicInventory({
  admin,
  back,
  ...props
}: ClinicPatientProps & { admin: boolean | undefined; back: () => void }) {
  const { styles } = props,
    { t, i18n } = useTranslation();
  const [tab, setTab] = useState<ViewName>("items"),
    [route, setRoute] = useState<Route>(),
    [notice, setNotice] = useState<"movementSaved" | "catalogSaved">();
  function movementSaved() {
    setTab("ledger");
    setRoute(undefined);
    setNotice("movementSaved");
  }
  function open(view: Route) {
    setNotice(undefined);
    setRoute(view);
  }
  if (route?.kind === "movement")
    return (
      <MovementEditor
        {...props}
        item={route.item}
        seed={route.seed}
        back={() => setRoute(undefined)}
        saved={movementSaved}
      />
    );
  if (route?.kind === "catalog" && admin !== false)
    return (
      <CatalogEditor
        {...props}
        target={route.target}
        back={() => setRoute(undefined)}
        saved={() => {
          setRoute(undefined);
          setNotice("catalogSaved");
        }}
      />
    );
  if (route?.kind === "balances")
    return (
      <View style={styles.section}>
        <Action
          styles={styles}
          label={t("nativeInventory.backWarehouses")}
          onPress={() => setRoute(undefined)}
        />
        <Text accessibilityRole="header" style={styles.heading}>
          {t("nativeInventory.balancesIn", { warehouse: route.warehouse.name })}
        </Text>
        <Balances
          {...props}
          warehouseId={route.warehouse.id}
          render={(b) => (
            <>
              <Text style={styles.heading}>
                {b.itemName} · {b.sku}
              </Text>
              <Text style={styles.support}>
                {t("nativeInventory.available", {
                  lot: b.lot || t("nativeInventory.noLot"),
                  amount: displayQuantity(b.quantity, i18n.language),
                  unit: b.unit,
                })}
              </Text>
              <Action
                styles={styles}
                label={t("nativeInventory.moveStock")}
                onPress={() =>
                  open({
                    kind: "movement",
                    item: { id: b.itemId, name: b.itemName, sku: b.sku, unit: b.unit },
                    seed: b,
                  })
                }
              />
            </>
          )}
        />
      </View>
    );
  return (
    <View style={styles.section}>
      <Action styles={styles} label={t("nativePatients.backPatients")} onPress={back} />
      <Text accessibilityRole="header" style={styles.heading}>
        {t("nativeInventory.title")}
      </Text>
      <View
        style={styles.actions}
        accessibilityRole="radiogroup"
        accessibilityLabel={t("nativeInventory.title")}
      >
        {(["items", "warehouses", "ledger"] as const).map((k) => (
          <Action
            key={k}
            styles={styles}
            role="radio"
            selected={tab === k}
            label={t(`nativeInventory.${k}`)}
            onPress={() => {
              setTab(k);
              setRoute(undefined);
              setNotice(undefined);
            }}
          />
        ))}
      </View>
      {notice && (
        <Text accessibilityLiveRegion="polite" style={styles.support}>
          {t(`nativeInventory.${notice}`)}
        </Text>
      )}
      {tab === "ledger" ? (
        <InventoryLedger {...props} />
      ) : tab === "items" ? (
        <>
          {admin && (
            <Action
              styles={styles}
              label={t("nativeInventory.newItem")}
              onPress={() => open({ kind: "catalog", target: { kind: "item" } })}
            />
          )}
          <Items
            {...props}
            render={(i) => (
              <>
                <Text accessibilityRole="header" style={styles.heading}>
                  {i.name} · {i.sku}
                </Text>
                <Text style={styles.support}>
                  {t("nativeInventory.unitValue", { unit: i.unit })}
                </Text>
                <View style={styles.actions}>
                  <Action
                    styles={styles}
                    label={t("nativeInventory.moveStock")}
                    accessibilityLabel={t("nativeInventory.movementFor", {
                      item: i.name,
                      sku: i.sku,
                    })}
                    onPress={() => open({ kind: "movement", item: i })}
                  />
                  {admin && (
                    <Action
                      styles={styles}
                      label={t("nativeInventory.editItem")}
                      onPress={() => open({ kind: "catalog", target: { kind: "item", item: i } })}
                    />
                  )}
                </View>
              </>
            )}
          />
        </>
      ) : (
        <>
          {admin && (
            <Action
              styles={styles}
              label={t("nativeInventory.newWarehouse")}
              onPress={() => open({ kind: "catalog", target: { kind: "warehouse" } })}
            />
          )}
          <Warehouses
            {...props}
            render={(w) => (
              <>
                <Text accessibilityRole="header" style={styles.heading}>
                  {w.name}
                </Text>
                <View style={styles.actions}>
                  <Action
                    styles={styles}
                    label={t("nativeInventory.balancesIn", { warehouse: w.name })}
                    onPress={() => open({ kind: "balances", warehouse: w })}
                  />
                  {admin && (
                    <Action
                      styles={styles}
                      label={t("nativeInventory.editWarehouse")}
                      onPress={() =>
                        open({ kind: "catalog", target: { kind: "warehouse", warehouse: w } })
                      }
                    />
                  )}
                </View>
              </>
            )}
          />
        </>
      )}
    </View>
  );
}
