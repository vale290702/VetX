import { NativeEntry } from "@vetx/ui-mobile";
import { registerRootComponent } from "expo";
import { createElement } from "react";

function App() {
  return createElement(NativeEntry, {
    audience: "staff",
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
    auth: {
      issuerUrl: process.env.EXPO_PUBLIC_OIDC_ISSUER_URL,
      clientId: process.env.EXPO_PUBLIC_OIDC_STAFF_CLIENT_ID,
      redirectUri: "vetx-staff://auth/callback",
    },
  });
}

registerRootComponent(App);
