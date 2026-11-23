import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Action } from "./controls";
import { Pager, PatientReadState, usePatientRead } from "./patient-controls";
import { displayQuantity } from "./inventory-forms";
import type { ClinicPatientProps } from "./patient-form";
export function InventoryLedger({
  client,
  scope,
  styles,
  pendingId,
  finish,
}: ClinicPatientProps & { pendingId?: string; finish?: () => void }) {
  const { t, i18n } = useTranslation(),
    [page, setPage] = useState(1),
    [expanded, setExpanded] = useState<string>();
  const load = useCallback(() => client.inventory.ledger(scope, page), [client, scope, page]);
  const { result, reload } = usePatientRead(load);
  if (!result || "error" in result)
    return <PatientReadState styles={styles} error={result?.error} retry={reload} />;
  const { movements, hasNextPage } = result.value;
  return (
    <View style={styles.section}>
      <Action styles={styles} label={t("nativeInventory.refresh")} onPress={reload} />
      {pendingId && finish && movements.some((m) => m.id === pendingId) && (
        <Action
          styles={styles}
          primary
          label={t("nativeInventory.matched", { id: pendingId })}
          onPress={finish}
        />
      )}
      {!movements.length && <Text style={styles.support}>{t("nativeInventory.emptyLedger")}</Text>}
      {movements.map((m) => {
        const from = m.fromWarehouseName,
          to = m.toWarehouseName;
        const amount = (value: string) => displayQuantity(value, i18n.language) + " " + m.unit;
        return (
          <View key={m.id} style={styles.row}>
            <Text accessibilityRole="header" style={styles.heading}>
              {t(`nativeInventory.kinds.${m.kind}`)} · {m.itemName} · {m.sku} · {amount(m.quantity)}
            </Text>
            <Text style={styles.support}>
              {[from, to].filter(Boolean).join(" → ")} ·{" "}
              {new Date(m.recordedAt).toLocaleString(i18n.language)}
            </Text>
            <Action
              styles={styles}
              label={t(expanded === m.id ? "nativeInventory.hide" : "nativeInventory.details")}
              expanded={expanded === m.id}
              onPress={() => setExpanded(expanded === m.id ? undefined : m.id)}
            />
            {expanded === m.id && (
              <>
                <Text selectable style={styles.support}>
                  {m.reason}
                </Text>
                <Text selectable style={styles.support}>
                  {t("nativeInventory.lot", { lot: m.lot || t("nativeInventory.noLot") })}
                </Text>
                {from && m.fromBalance !== null && (
                  <Text style={styles.support}>
                    {t("nativeInventory.after", { warehouse: from, amount: amount(m.fromBalance) })}
                  </Text>
                )}
                {to && m.toBalance !== null && (
                  <Text style={styles.support}>
                    {t("nativeInventory.after", { warehouse: to, amount: amount(m.toBalance) })}
                  </Text>
                )}
                <Text selectable style={styles.support}>
                  {t("nativeInventory.itemId", { id: m.itemId })}
                </Text>
                {m.fromWarehouseId && (
                  <Text selectable style={styles.support}>
                    {t("nativeInventory.fromId", { id: m.fromWarehouseId })}
                  </Text>
                )}
                {m.toWarehouseId && (
                  <Text selectable style={styles.support}>
                    {t("nativeInventory.toId", { id: m.toWarehouseId })}
                  </Text>
                )}
                <Text selectable style={styles.support}>
                  {t("nativeInventory.by", { actor: m.actor.subject, issuer: m.actor.issuer })}
                </Text>
                <Text selectable style={styles.support}>
                  {t("nativeInventory.movementId", { id: m.id })}
                </Text>
              </>
            )}
          </View>
        );
      })}
      <Pager
        styles={styles}
        page={page}
        next={hasNextPage}
        change={(p) => {
          setExpanded(undefined);
          setPage(p);
        }}
      />
    </View>
  );
}
