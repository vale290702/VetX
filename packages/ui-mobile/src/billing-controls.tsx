import { useCallback, useRef, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Action, type AccessStyles } from "./controls";
import {
  PatientNotice,
  PatientReadState,
  Pager,
  usePatientAction,
  usePatientRead,
} from "./patient-controls";
import { inventoryWrite } from "./inventory-client";
import { preserveAttempt, type Attempt } from "./inventory-forms";
import type { MobileAccount } from "./session";
import { formatDecimal } from "./billing-forms";

export function useBillingWrite<T, R>(
  account: MobileAccount,
  put: (id: string, body: T) => Promise<R>,
  done: (result: R) => void,
) {
  const action = usePatientAction(account),
    saved = useRef<Attempt<T> | undefined>(undefined);
  const [pending, setPending] = useState<Attempt<T>>(),
    [issue, setIssue] = useState<"conflict" | "denied" | "invalid">();
  function submit(body: T | undefined, id?: string) {
    if (action.busy || (!body && !saved.current) || issue === "denied" || issue === "conflict")
      return;
    const attempt =
      saved.current ?? preserveAttempt(undefined, id ?? globalThis.expo.uuidv4(), body!);
    saved.current = attempt;
    setPending(attempt);
    setIssue(undefined);
    void action.run(
      () => inventoryWrite(() => put(attempt.id, attempt.body)),
      (result) => {
        saved.current = undefined;
        setPending(undefined);
        if (result.issue) {
          setIssue(result.issue);
          return;
        }
        done(result.value);
      },
    );
  }
  return {
    pending,
    busy: action.busy,
    error: action.error,
    issue,
    submit,
    clear: () => {
      action.clear();
      setIssue(undefined);
    },
  };
}
type WriteStatus = {
  pending?: { id: string };
  busy: boolean;
  error: ReturnType<typeof usePatientAction>["error"];
  issue?: "denied" | "invalid" | "conflict";
};
export function WriteNotice({ styles, state }: { styles: AccessStyles; state: WriteStatus }) {
  const { t } = useTranslation();
  return (
    <>
      <PatientNotice styles={styles} error={state.error} />
      {state.pending && !state.busy && (
        <Text accessibilityRole="alert" style={styles.support}>
          {t("nativeBilling.retryHint", { id: state.pending.id })}
        </Text>
      )}
      {state.issue && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t(`nativeBilling.errors.${state.issue}`)}
        </Text>
      )}
    </>
  );
}
export function Submit({
  styles,
  state,
  valid,
  label,
  onPress,
}: {
  styles: AccessStyles;
  state: WriteStatus;
  valid: boolean;
  label: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <WriteNotice styles={styles} state={state} />
      <Action
        styles={styles}
        primary
        busy={state.busy}
        disabled={
          (!valid && !state.pending) || state.issue === "denied" || state.issue === "conflict"
        }
        label={state.pending ? t("nativeBilling.retry") : label}
        onPress={onPress}
      />
    </>
  );
}
export function GoBack({
  styles,
  onPress,
  disabled = false,
}: {
  styles: AccessStyles;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Action styles={styles} disabled={disabled} label={t("nativeBilling.back")} onPress={onPress} />
  );
}
export function Heading({ styles, children }: { styles: AccessStyles; children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={styles.heading}>
      {children}
    </Text>
  );
}
export function BillingRows<T extends { id: string }>({
  load,
  render,
  styles,
  empty,
}: {
  load: (page: number) => Promise<{ rows: T[]; hasNextPage: boolean }>;
  render: (row: T) => ReactNode;
  styles: AccessStyles;
  empty: string;
}) {
  const { t } = useTranslation(),
    [page, setPage] = useState(1);
  const { result, reload } = usePatientRead(useCallback(() => load(page), [load, page]));
  if (!result || "error" in result)
    return <PatientReadState styles={styles} error={result?.error} retry={reload} />;
  return (
    <View style={styles.section}>
      <Action styles={styles} label={t("nativeBilling.refresh")} onPress={reload} />
      {!result.value.rows.length && <Text style={styles.support}>{empty}</Text>}
      {result.value.rows.map((row) => (
        <View style={styles.row} key={row.id}>
          {render(row)}
        </View>
      ))}
      <Pager page={page} next={result.value.hasNextPage} change={setPage} styles={styles} />
    </View>
  );
}
export function Totals({
  styles,
  values,
  currency,
}: {
  styles: AccessStyles;
  values: { subtotal: string; tax: string; total: string; paid?: string; balance?: string };
  currency: string;
}) {
  const { t, i18n } = useTranslation();
  return (
    <View style={styles.section}>
      {(["subtotal", "tax", "total", "paid", "balance"] as const).map(
        (k) =>
          values[k] !== undefined && (
            <Text
              key={k}
              style={k === "total" || k === "balance" ? styles.heading : styles.support}
            >
              {t(`nativeBilling.totals.${k}`, {
                amount: formatDecimal(values[k]!, i18n.language),
                currency,
              })}
            </Text>
          ),
      )}
    </View>
  );
}
