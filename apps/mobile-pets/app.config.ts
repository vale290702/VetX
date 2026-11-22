import type { ExpoConfig } from "expo/config";

import en from "../../packages/i18n/locales/en.json";
import es from "../../packages/i18n/locales/es.json";

const appNames = { es: es.entry.pets.appName, en: en.entry.pets.appName };

const config: ExpoConfig = {
  name: appNames.es,
  slug: "vetx-pets",
  scheme: "vetx-pets",
  version: "0.1.0",
  userInterfaceStyle: "automatic",
  platforms: ["ios", "android"],
  plugins: [["expo-secure-store", { faceIDPermission: false }]],
  ios: {
    bundleIdentifier: "com.vetx.pets",
    infoPlist: { CFBundleAllowMixedLocalizations: true },
  },
  android: { package: "com.vetx.pets" },
  locales: Object.fromEntries(
    Object.entries(appNames).map(([locale, appName]) => [
      locale,
      { ios: { CFBundleDisplayName: appName }, android: { app_name: appName } },
    ]),
  ),
};

export default config;
