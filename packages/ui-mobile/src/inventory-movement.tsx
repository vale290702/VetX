import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Action, Field } from "./controls";
import { InventoryLedger } from "./inventory-ledger";
import { Balances, Warehouses, InventoryAccessLost } from "./inventory-lists";
import { PatientNotice, usePatientAction } from "./patient-controls";
import { inventoryWrite } from "./inventory-client";
import type { ClinicPatientProps } from "./patient-form";
import {
  canDebit,
  displayQuantity,
  kinds,
  movementInput,
  needsFrom,
  needsTo,
  preserveAttempt,
  stockQuantity,
  type Kind,
  type Attempt,
  type Balance,
  type Item,
  type MovementBody,
  type Warehouse,
} from "./inventory-forms";
type Location = Pick<Warehouse, "id" | "name">;
export type MovementItem = Pick<Item, "id" | "name" | "unit" | "sku">;
type Props = ClinicPatientProps & {
  item: MovementItem;
  seed?: Balance;
  back: () => void;
  saved: () => void;
};
export function MovementEditor({ item, seed, back, saved, ...props }: Props) {
  const { styles, client, scope, account } = props,
    { t, i18n } = useTranslation();
  const [checking, setChecking] = useState(false);
  const [id] = useState(() => globalThis.expo.uuidv4());
  const [kind, setKind] = useState<Kind>(seed ? "ISSUE" : "RECEIPT");
  const [from, setFrom] = useState<Location | undefined>(
      seed && { id: seed.warehouseId, name: seed.warehouseName },
    ),
    [to, setTo] = useState<Location>();
  const [balance, setBalance] = useState<Balance | undefined>(seed),
    [lot, setLot] = useState(seed?.lot ?? "");
  const [quantity, setQuantity] = useState(""),
    [reason, setReason] = useState(""),
    [picker, setPicker] = useState<"from" | "to" | "lot">();
  const [pending, setPending] = useState<Attempt<MovementBody>>(),
    [failure, setFailure] = useState<"denied" | "conflict" | "invalid">();
  const action = usePatientAction(account),
    locked = !!pending || action.busy;
  const debit = needsFrom(kind),
    credit = needsTo(kind),
    amount = stockQuantity(quantity);
  const tooMuch = !!(debit && balance && amount && !canDebit(balance.quantity, amount));
  const body = movementInput({
    itemId: item.id,
    unit: item.unit,
    kind,
    quantity,
    fromWarehouseId: from?.id ?? null,
    toWarehouseId: to?.id ?? null,
    lot: debit ? (balance?.lot ?? "") : lot,
    reason,
  });
  const canSend =
    !!body &&
    (!debit || (balance?.warehouseId === from?.id && balance?.itemId === item.id)) &&
    !tooMuch;
  function submit() {
    if (!body || !canSend) return;
    const attempt = preserveAttempt(pending, id, body);
    setPending(attempt);
    setFailure(undefined);
    void action.run(
      () => inventoryWrite(() => client.inventory.move(scope, attempt.id, attempt.body)),
      (result) => {
        if ("issue" in result && result.issue) {
          setFailure(result.issue);
          setPending(undefined);
        } else saved();
      },
    );
  }
  function pickWarehouse(w: Location) {
    if (picker === "from") {
      if (w.id !== from?.id) setBalance(undefined);
      setFrom(w);
      if (w.id === to?.id) setTo(undefined);
    } else setTo(w);
    setPicker(undefined);
  }
  if (failure === "denied") return <InventoryAccessLost styles={styles} back={back} />;
  if (checking && pending)
    return (
      <View style={styles.section}>
        <Action
          styles={styles}
          label={t("nativeInventory.resume")}
          onPress={() => setChecking(false)}
        />
        <Text style={styles.heading} accessibilityRole="header">
          {t("nativeInventory.ledger")}
        </Text>
        <Text selectable style={styles.support}>
          {t("nativeInventory.movementId", { id: pending.id })}
        </Text>
        <InventoryLedger {...props} pendingId={pending.id} finish={saved} />
        <Action styles={styles} label={t("nativeInventory.backInventory")} onPress={back} />
      </View>
    );
  if (picker)
    return (
      <View style={styles.section}>
        <Action
          styles={styles}
          label={t("nativeInventory.backMovement")}
          onPress={() => setPicker(undefined)}
        />
        <Text accessibilityRole="header" style={styles.heading}>
          {t(
            picker === "from"
              ? "nativeInventory.from"
              : picker === "to"
                ? "nativeInventory.to"
                : "nativeInventory.chooseLot",
          )}
        </Text>
        {picker === "lot" && from ? (
          <Balances
            {...props}
            warehouseId={from.id}
            itemId={item.id}
            render={(b) => (
              <Action
                styles={styles}
                label={
                  (b.lot || t("nativeInventory.noLot")) +
                  " · " +
                  displayQuantity(b.quantity, i18n.language) +
                  " " +
                  b.unit
                }
                onPress={() => {
                  setBalance(b);
                  setPicker(undefined);
                }}
              />
            )}
          />
        ) : (
          <Warehouses
            {...props}
            exclude={picker === "to" && debit ? from?.id : undefined}
            render={(w) => (
              <Action styles={styles} label={w.name} onPress={() => pickWarehouse(w)} />
            )}
          />
        )}
      </View>
    );
  return (
    <View style={styles.section}>
      <Action
        styles={styles}
        disabled={action.busy}
        label={t(pending ? "nativeInventory.checkLedger" : "nativeInventory.backInventory")}
        onPress={pending ? () => setChecking(true) : back}
      />
      <Text accessibilityRole="header" style={styles.heading}>
        {t("nativeInventory.movementFor", { item: item.name, sku: item.sku })}
      </Text>
      <Text style={styles.heading}>{t("nativeInventory.type")}</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t("nativeInventory.type")}
        style={styles.actions}
      >
        {kinds.map((k) => (
          <Action
            key={k}
            styles={styles}
            role="radio"
            selected={kind === k}
            disabled={locked}
            label={t(`nativeInventory.kinds.${k}`)}
            onPress={() => setKind(k)}
          />
        ))}
      </View>
      {debit && (
        <>
          <Text style={styles.heading}>{t("nativeInventory.from")}</Text>
          <Action
            styles={styles}
            disabled={locked}
            label={from?.name ?? t("nativeInventory.chooseWarehouse")}
            onPress={() => setPicker("from")}
          />
          {from && (
            <Action
              styles={styles}
              disabled={locked}
              label={
                balance
                  ? t("nativeInventory.available", {
                      lot: balance.lot || t("nativeInventory.noLot"),
                      amount: displayQuantity(balance.quantity, i18n.language),
                      unit: item.unit,
                    })
                  : t("nativeInventory.chooseLot")
              }
              onPress={() => setPicker("lot")}
            />
          )}
        </>
      )}
      {credit && (
        <>
          <Text style={styles.heading}>{t("nativeInventory.to")}</Text>
          <Action
            styles={styles}
            disabled={locked}
            label={to?.name ?? t("nativeInventory.chooseWarehouse")}
            onPress={() => setPicker("to")}
          />
        </>
      )}
      {!debit && (
        <Field
          styles={styles}
          label={t("nativeInventory.lotLabel")}
          value={lot}
          onChange={setLot}
          disabled={locked}
          maxLength={120}
          identifier
        />
      )}
      <Field
        styles={styles}
        label={t("nativeInventory.quantity", { unit: item.unit })}
        value={quantity}
        onChange={setQuantity}
        disabled={locked}
        maxLength={19}
        inputMode="decimal"
      />
      <Text style={styles.support}>{t("nativeInventory.amountHelp")}</Text>
      {!!quantity && !amount && (
        <Text style={styles.error}>{t("nativeInventory.invalidAmount")}</Text>
      )}
      {tooMuch && <Text style={styles.error}>{t("nativeInventory.insufficient")}</Text>}
      <Field
        styles={styles}
        label={t("nativeInventory.reason")}
        value={reason}
        onChange={setReason}
        disabled={locked}
        maxLength={250}
      />
      <PatientNotice styles={styles} error={action.error} />
      {pending && action.error && (
        <Text selectable accessibilityRole="alert" style={styles.error}>
          {t("nativeInventory.uncertainMovement", { id: pending.id })}
        </Text>
      )}
      {failure && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t(failure === "conflict" ? "nativeInventory.stockConflict" : "nativeInventory.invalid")}
        </Text>
      )}
      {failure === "conflict" && (
        <Action
          styles={styles}
          label={t("nativeInventory.reviewStock")}
          onPress={() => {
            setFailure(undefined);
            if (debit && from) {
              setBalance(undefined);
              setPicker("lot");
            } else if (credit) {
              setTo(undefined);
              setPicker("to");
            }
          }}
        />
      )}
      <Action
        styles={styles}
        primary
        busy={action.busy}
        disabled={!canSend || failure === "conflict"}
        label={t(
          pending && action.error ? "nativeInventory.retryMovement" : "nativeInventory.record",
        )}
        onPress={submit}
      />
    </View>
  );
}
