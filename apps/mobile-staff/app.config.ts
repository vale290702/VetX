import type { ExpoConfig } from "expo/config";

import en from "../../packages/i18n/locales/en.json";
import es from "../../packages/i18n/locales/es.json";

const appNames = { es: es.entry.staff.appName, en: en.entry.staff.appName };

const config: ExpoConfig = {
  name: appNames.es,
  slug: "vetx-staff",
  scheme: "vetx-staff",
  version: "0.1.0",
  userInterfaceStyle: "automatic",
  platforms: ["ios", "android"],
  plugins: [["expo-secure-store", { faceIDPermission: false }]],
  ios: {
    bundleIdentifier: "com.vetx.staff",
    infoPlist: { CFBundleAllowMixedLocalizations: true },
  },
  android: { package: "com.vetx.staff" },
  locales: Object.fromEntries(
    Object.entries(appNames).map(([locale, appName]) => [
      locale,
      { ios: { CFBundleDisplayName: appName }, android: { app_name: appName } },
    ]),
  ),
};

export default config;
