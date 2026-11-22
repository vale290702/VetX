import { NativeEntry } from "@vetx/ui-mobile";
import { registerRootComponent } from "expo";
import { createElement } from "react";

function App() {
  return createElement(NativeEntry, {
    audience: "staff",
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
  });
}

registerRootComponent(App);
