import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Action, Field, type AccessStyles } from "./controls";
import { inventoryWrite } from "./inventory-client";
import { preserveAttempt, type Attempt } from "./inventory-forms";
import { PatientNotice, usePatientAction } from "./patient-controls";
import type { MobileAccount } from "./session";
export type Notice = "saved" | "changed" | "denied";
export type Close = (notice?: Notice) => void;
export function useTradeSave<T>(
  account: MobileAccount,
  save: (id: string, body: T) => Promise<unknown>,
  close: Close,
  existing?: string,
) {
  const [id] = useState(() => existing ?? globalThis.expo.uuidv4()),
    [pending, setPending] = useState<Attempt<T>>(),
    [invalid, setInvalid] = useState(false);
  const action = usePatientAction(account);
  function submit(body: T | undefined) {
    if (!body && !pending) return;
    const write = pending ?? (body ? preserveAttempt(undefined, id, body) : undefined);
    if (!write) return;
    setPending(write);
    setInvalid(false);
    void action.run(
      () => inventoryWrite(() => save(write.id, write.body)),
      (result) => {
        if (result.issue === "invalid") {
          setInvalid(true);
          setPending(undefined);
          return;
        }
        close(
          result.issue === "denied" ? "denied" : result.issue === "conflict" ? "changed" : "saved",
        );
      },
    );
  }
  return {
    submit,
    locked: !!pending || action.busy,
    busy: action.busy,
    error: action.error,
    invalid,
    pendingId: pending?.id,
  };
}
type SaveState = Omit<ReturnType<typeof useTradeSave>, "submit">;
export function ConfirmWrite({
  styles,
  state,
  valid,
  label,
  submit,
}: {
  styles: AccessStyles;
  state: SaveState;
  valid: boolean;
  label: string;
  submit: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.section}>
      {state.invalid && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t("nativeTrade.invalid")}
        </Text>
      )}
      <PatientNotice styles={styles} error={state.error} />
      {state.pendingId && !state.busy && (
        <Text selectable accessibilityRole="alert" style={styles.error}>
          {t("nativeTrade.uncertain", { id: state.pendingId })}
        </Text>
      )}
      <Action
        styles={styles}
        primary
        label={state.pendingId && !state.busy ? t("nativeTrade.retry") : label}
        busy={state.busy}
        disabled={!state.pendingId && !valid}
        onPress={submit}
      />
    </View>
  );
}
export function TradeNotice({ notice, styles }: { notice?: Notice; styles: AccessStyles }) {
  const { t } = useTranslation();
  return notice ? (
    <Text
      accessibilityLiveRegion="polite"
      style={notice === "saved" ? styles.support : styles.error}
    >
      {t(`nativeTrade.${notice}`)}
    </Text>
  ) : null;
}
export function AmountField({
  styles,
  unit,
  value,
  onChange,
  locked,
}: {
  styles: AccessStyles;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  locked: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Field
      styles={styles}
      label={t("nativeInventory.quantity", { unit })}
      value={value}
      onChange={onChange}
      maxLength={19}
      inputMode="decimal"
      disabled={locked}
    />
  );
}
export function EventAuthor({
  event,
  styles,
}: {
  event: { author: { subject: string; issuer: string }; recordedAt: string };
  styles: AccessStyles;
}) {
  const { t, i18n } = useTranslation();
  return (
    <Text selectable style={styles.support}>
      {new Date(event.recordedAt).toLocaleString(i18n.language)} ·{" "}
      {t("nativeInventory.by", { actor: event.author.subject, issuer: event.author.issuer })}
    </Text>
  );
}
