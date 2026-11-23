import { readFileSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";
import { Window } from "happy-dom";
import { act, createElement as h } from "react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import enBilling from "../../../i18n/locales/native-billing.en.json" with { type: "json" };

const window = new Window();
globalThis.window = window;
globalThis.document = window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.expo = { uuidv4: () => crypto.randomUUID() };
const { createRoot } = await import("react-dom/client");
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "react-native")
      return { url: new URL("./native-dom.mjs", import.meta.url).href, shortCircuit: true };
    if (
      specifier.startsWith(".") &&
      context.parentURL?.includes("/packages/ui-mobile/src/") &&
      !/\.\w+$/.test(specifier)
    ) {
      for (const ext of [".ts", ".tsx"]) {
        const url = new URL(specifier + ext, context.parentURL);
        if (existsSync(url)) return { url: url.href, shortCircuit: true };
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.endsWith(".tsx")) return next(url, context);
    return {
      format: "module",
      shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ESNext,
          jsx: ts.JsxEmit.ReactJSX,
        },
      }).outputText,
    };
  },
});
const i18n = createInstance();
await i18n.init({
  lng: "en",
  resources: { en: { translation: { nativeBilling: enBilling } } },
  interpolation: { prefix: "{", suffix: "}" },
});
export function screen(t, component) {
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host);
  t.after(async () => {
    await act(() => root.unmount());
    host.remove();
  });
  const visible = (element) => !element.closest('[style*="display: none"]');
  const button = (label) =>
    [...host.querySelectorAll("button")].find(
      (element) =>
        visible(element) &&
        (element.textContent === label || element.getAttribute("aria-label") === label),
    );
  return {
    render: (props) =>
      act(async () => root.render(h(I18nextProvider, { i18n }, h(component, props)))),
    button,
    press: async (label) => {
      const target = button(label);
      if (!target || target.disabled) throw Error("Action unavailable: " + label);
      await act(async () => target.click());
    },
    fill: async (label, value) => {
      const input = [...host.querySelectorAll("input")].find(
        (i) => visible(i) && i.getAttribute("aria-label") === label,
      );
      if (!input || input.disabled) throw Error("Field unavailable: " + label);
      await act(async () => {
        input.value = value;
        input.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
    },
  };
}
