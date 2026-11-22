import { radius, size, space, typography, type Palette } from "@vetx/design-tokens";
import type { EntryAudience } from "@vetx/i18n";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import type { createExpoAuth } from "./expo-session";
import type { MobileAccount, SessionState } from "./session";

type Auth = NonNullable<ReturnType<typeof createExpoAuth>>;

const createStyles = (palette: Palette) =>
  StyleSheet.create({
    section: { gap: space.inline },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: space.compact },
    action: {
      alignItems: "center",
      justifyContent: "center",
      minHeight: size.touch,
      minWidth: size.touch,
      maxWidth: "100%",
      borderRadius: radius.control,
      paddingHorizontal: space.regular,
      paddingVertical: space.compact,
      backgroundColor: palette.control,
    },
    actionPrimary: { backgroundColor: palette.folio },
    actionPressed: { opacity: 0.8 },
    actionText: { color: palette.ink, fontSize: typography.caption, fontWeight: "600" },
    actionPrimaryText: { color: palette.folioInk },
    pending: { flexDirection: "row", alignItems: "center", gap: space.compact },
    support: { flexShrink: 1, color: palette.muted, fontSize: typography.caption },
    error: { color: palette.warning, fontSize: typography.caption },
    heading: { color: palette.ink, fontSize: typography.body, fontWeight: "600" },
    organizationList: { gap: space.compact },
  });

type AccessStyles = ReturnType<typeof createStyles>;

function Action({
  label,
  onPress,
  styles,
  primary = false,
  busy = false,
}: {
  label: string;
  onPress: () => void;
  styles: AccessStyles;
  primary?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        primary && styles.actionPrimary,
        (pressed || busy) && styles.actionPressed,
      ]}
    >
      <Text style={[styles.actionText, primary && styles.actionPrimaryText]}>{label}</Text>
    </Pressable>
  );
}

function AccountSummary({
  account,
  audience,
  styles,
}: {
  account: MobileAccount;
  audience: EntryAudience;
  styles: AccessStyles;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.section}>
      <Text accessibilityLiveRegion="polite" style={styles.support}>
        {t("nativeAuth.signedIn")}
      </Text>
      {audience === "staff" && (
        <View style={styles.organizationList}>
          <Text accessibilityRole="header" style={styles.heading}>
            {t("nativeAuth.organizations")}
          </Text>
          {account.organizations.length ? (
            account.organizations.map((organization) => (
              <Text key={organization.id} style={styles.support}>
                {organization.name}
              </Text>
            ))
          ) : (
            <Text style={styles.support}>{t("nativeAuth.noOrganizations")}</Text>
          )}
        </View>
      )}
    </View>
  );
}

const progressLabels = {
  checking: "nativeAuth.checkSession",
  signingIn: "nativeAuth.signingIn",
  signingOut: "nativeAuth.signingOut",
} as const;

function LiveAccess({
  auth,
  audience,
  styles,
  palette,
}: {
  auth: Auth;
  audience: EntryAudience;
  styles: AccessStyles;
  palette: Palette;
}) {
  const { session, accountUrl } = auth;
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { t, i18n } = useTranslation();
  const [consoleBusy, setConsoleBusy] = useState(false);
  const [consoleFailed, setConsoleFailed] = useState(false);
  const checkAt = state.status === "signedIn" ? state.checkAt : undefined;

  useEffect(() => {
    void session.restore();
    const subscription = AppState.addEventListener("change", (event) => {
      if (event === "active") void session.revalidate();
    });
    return () => subscription.remove();
  }, [session]);

  useEffect(() => {
    if (checkAt === undefined) return;
    const timer = setTimeout(
      () => {
        if (AppState.currentState === "active") void session.revalidate();
      },
      Math.max(0, checkAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [checkAt, session]);

  async function openAccount() {
    setConsoleBusy(true);
    setConsoleFailed(false);
    try {
      await WebBrowser.openBrowserAsync(accountUrl);
    } catch {
      setConsoleFailed(true);
    } finally {
      setConsoleBusy(false);
    }
  }

  const signOut = () => {
    setConsoleFailed(false);
    void session.signOut();
  };
  const showAccountSettings =
    state.status === "signedIn" ||
    (state.status === "signedOut" && state.issue === "revocationFailed");
  const canSignOut =
    state.status === "signedIn" ||
    state.status === "verificationFailed" ||
    (state.status === "checking" && state.canSignOut);

  return (
    <View style={styles.section}>
      <SessionStatus state={state} styles={styles} palette={palette} />
      {state.status === "signedIn" && (
        <AccountSummary account={state.account} audience={audience} styles={styles} />
      )}
      {consoleFailed && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t("nativeAuth.errors.accountConsole")}
        </Text>
      )}
      <View style={styles.actions}>
        {state.status === "signedOut" && (
          <Action
            label={t("nativeAuth.signIn")}
            onPress={() => {
              setConsoleFailed(false);
              void session.signIn(i18n.language);
            }}
            styles={styles}
            primary
          />
        )}
        {showAccountSettings && (
          <Action
            busy={consoleBusy}
            label={t("nativeAuth.manageAccount")}
            onPress={() => void openAccount()}
            styles={styles}
          />
        )}
        {state.status === "verificationFailed" && (
          <Action
            label={t("nativeAuth.retryVerification")}
            onPress={() => void session.revalidate()}
            styles={styles}
            primary
          />
        )}
        {canSignOut && <Action label={t("nativeAuth.signOut")} onPress={signOut} styles={styles} />}
        {state.status === "logoutFailed" && (
          <Action label={t("nativeAuth.retrySignOut")} onPress={signOut} styles={styles} primary />
        )}
      </View>
    </View>
  );
}

function SessionStatus({
  state,
  styles,
  palette,
}: {
  state: SessionState;
  palette: Palette;
  styles: AccessStyles;
}) {
  const { t } = useTranslation();
  if (
    state.status === "checking" ||
    state.status === "signingIn" ||
    state.status === "signingOut"
  ) {
    return (
      <View style={styles.pending}>
        <ActivityIndicator color={palette.positive} accessible={false} />
        <Text accessibilityLiveRegion="polite" style={styles.support}>
          {t(progressLabels[state.status])}
        </Text>
      </View>
    );
  }
  const issue =
    state.status === "logoutFailed" || state.status === "verificationFailed"
      ? state.status
      : state.status === "signedOut"
        ? state.issue
        : undefined;
  return issue ? (
    <Text accessibilityRole="alert" style={styles.error}>
      {t(`nativeAuth.errors.${issue}`)}
    </Text>
  ) : null;
}

export function AccessPanel({
  auth,
  audience,
  palette,
}: {
  auth: Auth | undefined;
  audience: EntryAudience;
  palette: Palette;
}) {
  const styles = useMemo(() => createStyles(palette), [palette]);
  const { t } = useTranslation();
  return auth ? (
    <LiveAccess auth={auth} audience={audience} styles={styles} palette={palette} />
  ) : (
    <Text accessibilityRole="alert" style={styles.error}>
      {t("nativeAuth.errors.unconfigured")}
    </Text>
  );
}
