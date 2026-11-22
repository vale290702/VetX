import type { Palette } from "@vetx/design-tokens";
import type { EntryAudience } from "@vetx/i18n";
import * as WebBrowser from "expo-web-browser";
import { Activity, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, AppState, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import type { createExpoAuth } from "./expo-session";
import type { MobileAccount, SessionState } from "./session";

import { Action, createStyles, type AccessStyles } from "./controls";
import { OwnerPets } from "./owner-pets";
import { StaffDirectory } from "./staff-directory";

type Auth = NonNullable<ReturnType<typeof createExpoAuth>>;

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
        <Text accessibilityLiveRegion="polite" style={styles.support}>
          {t("nativeAuth.signedIn")}
        </Text>
      )}
      {(state.status === "signedIn" || state.status === "checking") && (
        <VerifiedWorkspace
          account={state.status === "signedIn" ? state.account : undefined}
          auth={auth}
          audience={audience}
          styles={styles}
          openAccount={() => void openAccount()}
        />
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

function VerifiedWorkspace({
  account,
  auth,
  audience,
  styles,
  openAccount,
}: {
  account?: MobileAccount;
  auth: Auth;
  audience: EntryAudience;
  styles: AccessStyles;
  openAccount: () => void;
}) {
  // Keep form drafts during periodic /me verification. Sign-out unmounts this workspace.
  const [lastVerified, setLastVerified] = useState(account);
  if (account && account !== lastVerified) setLastVerified(account);
  const profile = account ?? lastVerified;
  if (!profile) return null;
  return (
    <Activity mode={account ? "visible" : "hidden"}>
      {audience === "pets" ? (
        <OwnerPets
          key={profile.subject}
          account={profile}
          client={auth.patients}
          styles={styles}
          openAccount={openAccount}
        />
      ) : (
        auth.directory && (
          <StaffDirectory
            key={profile.subject}
            account={profile}
            client={auth.directory}
            patients={auth.patients}
            styles={styles}
          />
        )
      )}
    </Activity>
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
