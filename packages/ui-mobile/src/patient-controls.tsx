import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Action, type AccessStyles } from "./controls";
import { patientFailure } from "./patients";
import type { MobileAccount } from "./session";

type Failure = ReturnType<typeof patientFailure>;
type Read<T> = { value: T } | { error: Failure };

export function usePatientRead<T>(load: () => Promise<T>) {
  const [version, setVersion] = useState(0);
  const [stored, setStored] = useState<{ load: typeof load; version: number; result: Read<T> }>();
  useEffect(() => {
    let active = true;
    function complete(result: Read<T>) {
      if (active) setStored({ load, version, result });
    }
    void load().then(
      (value) => complete({ value }),
      (error) => complete({ error: patientFailure(error, "read") }),
    );
    return () => {
      active = false;
    };
  }, [load, version]);
  return {
    result: stored?.load === load && stored.version === version ? stored.result : undefined,
    reload: () => setVersion((v) => v + 1),
  };
}

export function usePatientAction(account: MobileAccount) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure>();
  const lock = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    lock.current = false;
    setBusy(false);
    return () => {
      generation.current++;
    };
  }, [account]);
  async function run<T>(
    work: () => Promise<T>,
    success: (value: T) => void,
    action: "write" | "redeem" = "write",
  ) {
    if (lock.current) return;
    const current = generation.current;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const data = await work();
      if (generation.current === current) success(data);
    } catch (e) {
      if (generation.current === current) setError(patientFailure(e, action));
    } finally {
      if (generation.current === current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  return { busy, error, clear: () => setError(undefined), run } as const;
}

export function PatientNotice({ error, styles }: { error?: Failure; styles: AccessStyles }) {
  const { t } = useTranslation();
  return error ? (
    <Text accessibilityRole="alert" style={styles.error}>
      {t(`nativePatients.${error}`)}
    </Text>
  ) : null;
}

export function PatientReadState({
  error,
  retry,
  styles,
}: {
  error?: Failure;
  retry: () => void;
  styles: AccessStyles;
}) {
  const { t } = useTranslation();
  return error ? (
    <View style={styles.section}>
      <PatientNotice error={error} styles={styles} />
      <View style={styles.actions}>
        <Action styles={styles} label={t("directory.retry")} onPress={retry} />
      </View>
    </View>
  ) : (
    <Text accessibilityLiveRegion="polite" style={styles.support}>
      {t("nativePatients.loading")}
    </Text>
  );
}

export function Pager({
  page,
  next,
  change,
  styles,
}: {
  page: number;
  next: boolean;
  change: (n: number) => void;
  styles: AccessStyles;
}) {
  const { t } = useTranslation();
  if (page === 1 && !next) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.support}>{t("directory.page", { page })}</Text>
      <View style={styles.actions}>
        {page > 1 && (
          <Action
            styles={styles}
            label={t("directory.previous")}
            onPress={() => change(page - 1)}
          />
        )}
        {next && (
          <Action styles={styles} label={t("directory.next")} onPress={() => change(page + 1)} />
        )}
      </View>
    </View>
  );
}
