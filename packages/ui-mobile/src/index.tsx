import { InstrumentSerif_400Regular, useFonts } from "@expo-google-fonts/instrument-serif";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { checkVetxReadiness } from "@vetx/api-client";
import { parseHttpOrigin } from "@vetx/config/public";
import { colors, radius, size, space, typography, type Palette } from "@vetx/design-tokens";
import {
  defaultLocale,
  isLocale,
  locales,
  messages,
  type EntryAudience,
  type Locale,
  type ServiceStatus,
} from "@vetx/i18n";
import { createNativeI18n } from "@vetx/i18n/native";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { I18nextProvider, useTranslation } from "react-i18next";

import { AccessPanel } from "./access-panel";
import { createExpoAuth, type NativeAuthSettings } from "./expo-session";

type EntryProps = {
  audience: EntryAudience;
  apiUrl: string | undefined;
  auth: NativeAuthSettings;
};
type NativeI18n = Awaited<ReturnType<typeof createNativeI18n>>;

function useServiceStatus(apiUrl: string | undefined): ServiceStatus {
  const origin = parseHttpOrigin(apiUrl);
  const [result, setResult] = useState<{
    origin: string;
    status: "available" | "unavailable";
  }>();

  useEffect(() => {
    if (!origin) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    let mounted = true;
    void checkVetxReadiness(origin, controller.signal).then((status) => {
      clearTimeout(timeout);
      if (mounted) setResult({ origin, status });
    });
    return () => {
      mounted = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [origin]);

  if (!origin) return "unconfigured";
  return origin === result?.origin ? result.status : "checking";
}

const createStyles = (palette: Palette) =>
  StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: palette.canvas },
    scrollContent: { flexGrow: 1, padding: space.regular },
    layout: { flex: 1, width: "100%", maxWidth: 620, alignSelf: "center" },
    masthead: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      alignItems: "center",
      gap: space.inline,
      paddingBottom: space.regular,
      borderBottomColor: palette.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    wordmark: {
      color: palette.ink,
      fontSize: typography.wordmark,
      fontWeight: "700",
      letterSpacing: -0.75,
    },
    languages: { flexDirection: "row", flexWrap: "wrap", gap: space.compact },
    languageButton: {
      minHeight: size.touch,
      minWidth: size.touch,
      justifyContent: "center",
      paddingHorizontal: space.inline,
      paddingVertical: space.compact,
      borderRadius: radius.control,
    },
    languageText: { color: palette.muted, fontSize: typography.caption, fontWeight: "600" },
    languageSelected: { backgroundColor: palette.control },
    languageSelectedText: { color: palette.ink },
    content: { flex: 1, justifyContent: "center", paddingVertical: space.block },
    folio: {
      backgroundColor: palette.paper,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.line,
      borderRadius: radius.surface,
      overflow: "hidden",
    },
    copy: { gap: space.regular, padding: space.inset },
    title: {
      color: palette.ink,
      fontSize: typography.displayCompact,
      letterSpacing: -1.2,
      maxWidth: 390,
    },
    titleFont: { fontFamily: "InstrumentSerif_400Regular" },
    description: { color: palette.muted, fontSize: typography.body, maxWidth: 350 },
    status: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.compact,
      marginTop: space.regular,
      paddingTop: space.regular,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: palette.line,
    },
    statusText: { flexShrink: 1, color: palette.muted, fontSize: typography.caption },
    statusDot: {
      width: size.statusDot,
      height: size.statusDot,
      borderRadius: radius.round,
      backgroundColor: palette.muted,
    },
    readyDot: { backgroundColor: palette.positive },
    unavailableDot: { backgroundColor: palette.warning },
    checkingDot: {
      backgroundColor: "transparent",
      borderWidth: space.hairline,
      borderColor: palette.muted,
    },
    languageError: {
      color: palette.error,
      fontSize: typography.caption,
      marginTop: space.compact,
    },
    folioArt: {
      minHeight: space.wide * 2 + space.block,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: palette.folio,
    },
    folioFrame: {
      position: "absolute",
      top: space.regular,
      right: space.regular,
      bottom: space.regular,
      left: space.regular,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.folioLine,
      borderRadius: radius.control,
    },
    folioStroke: { position: "absolute", width: space.inline, height: space.wide + space.block },
    folioStrokeBack: { backgroundColor: palette.folioLine, transform: [{ rotate: "-42deg" }] },
    folioStrokeFront: { backgroundColor: palette.folioInk, transform: [{ rotate: "42deg" }] },
    centered: { flex: 1, justifyContent: "center", padding: space.inset, gap: space.regular },
    skeleton: {
      width: "65%",
      height: typography.displayCompact,
      borderRadius: radius.control,
      backgroundColor: palette.control,
    },
  });

type EntryStyles = ReturnType<typeof createStyles>;

function LocalizedEntry({
  audience,
  apiUrl,
  auth,
  styles,
  palette,
}: EntryProps & { styles: EntryStyles; palette: Palette }) {
  const { i18n, t } = useTranslation();
  const [fontsLoaded] = useFonts({ InstrumentSerif_400Regular });
  const [preferenceError, setPreferenceError] = useState(false);
  const status = useServiceStatus(apiUrl);
  const access = useMemo(() => createExpoAuth(audience, apiUrl, auth), [audience, apiUrl, auth]);
  const preferenceKey = `vetx.${audience}.locale`;

  async function selectLocale(locale: Locale) {
    if (i18n.language === locale) return;
    await i18n.changeLanguage(locale);
    try {
      await AsyncStorage.setItem(preferenceKey, locale);
      setPreferenceError(false);
    } catch {
      setPreferenceError(true);
    }
  }

  const serviceStyles = {
    available: styles.readyDot,
    unavailable: styles.unavailableDot,
    unconfigured: undefined,
    checking: styles.checkingDot,
  };

  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.scrollContent}
    >
      <View style={styles.layout}>
        <View style={styles.masthead}>
          <Text style={styles.wordmark}>{t("brand")}</Text>
          <View
            accessibilityLabel={t("language.label")}
            accessibilityRole="radiogroup"
            style={styles.languages}
          >
            {locales.map((locale) => {
              const selected = i18n.language === locale;
              return (
                <Pressable
                  accessibilityLanguage={locale}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  key={locale}
                  onPress={() => void selectLocale(locale)}
                  style={({ pressed }) => [
                    styles.languageButton,
                    (selected || pressed) && styles.languageSelected,
                  ]}
                >
                  <Text style={[styles.languageText, selected && styles.languageSelectedText]}>
                    {t(`language.${locale}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        {preferenceError && (
          <Text accessibilityRole="alert" style={styles.languageError}>
            {t("language.preferenceError")}
          </Text>
        )}
        <View style={styles.content}>
          <View style={styles.folio}>
            <View style={styles.copy}>
              <Text
                accessibilityRole="header"
                style={[styles.title, fontsLoaded && styles.titleFont]}
              >
                {t(`entry.${audience}.title`)}
              </Text>
              <Text style={styles.description}>{t(`entry.${audience}.description`)}</Text>
              <AccessPanel auth={access} audience={audience} palette={palette} />
              <View style={styles.status}>
                <View style={[styles.statusDot, serviceStyles[status]]} />
                <Text accessibilityLiveRegion="polite" style={styles.statusText}>
                  {t(`service.${status}`)}
                </Text>
              </View>
            </View>
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={styles.folioArt}
            >
              <View style={styles.folioFrame} />
              <View style={[styles.folioStroke, styles.folioStrokeBack]} />
              <View style={[styles.folioStroke, styles.folioStrokeFront]} />
            </View>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

async function readLocale(audience: EntryAudience) {
  try {
    const saved = await AsyncStorage.getItem(`vetx.${audience}.locale`);
    return isLocale(saved) ? saved : defaultLocale;
  } catch {
    console.warn("Unable to read the saved VetX locale.");
    return defaultLocale;
  }
}

export function NativeEntry(props: EntryProps) {
  const { audience } = props;
  const mode = useColorScheme() === "dark" ? "dark" : "light";
  const palette = colors[mode];
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [instance, setInstance] = useState<NativeI18n>();
  const [initializationFailed, setInitializationFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    void readLocale(audience)
      .then(createNativeI18n)
      .then((i18n) => {
        if (mounted) setInstance(i18n);
      })
      .catch(() => {
        if (mounted) setInitializationFailed(true);
      });
    return () => {
      mounted = false;
    };
  }, [audience]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style={mode === "dark" ? "light" : "dark"} />
        {instance ? (
          <I18nextProvider i18n={instance}>
            <LocalizedEntry {...props} styles={styles} palette={palette} />
          </I18nextProvider>
        ) : (
          <View style={styles.centered}>
            <Text accessibilityRole="header" style={styles.wordmark}>
              {messages[defaultLocale].brand}
            </Text>
            {initializationFailed ? (
              <Text accessibilityRole="alert" style={styles.description}>
                {messages[defaultLocale].language.initializationError}
              </Text>
            ) : (
              <View
                accessibilityLabel={messages[defaultLocale].language.loading}
                accessibilityRole="progressbar"
                accessible
                style={styles.skeleton}
              />
            )}
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
