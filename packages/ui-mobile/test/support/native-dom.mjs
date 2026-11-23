import { createElement as h } from "react";

// A DOM surface for the native host elements used by billing. React owns the full component tree.
export const StyleSheet = { create: (styles) => styles, hairlineWidth: 1 };
export const View = ({ children }) => h("div", null, children);
export const Text = ({ children }) => h("span", null, children);
export const Pressable = ({ children, onPress, disabled, accessibilityLabel }) =>
  h("button", { disabled, onClick: onPress, "aria-label": accessibilityLabel }, children);
export const TextInput = ({ value, onChangeText, editable, accessibilityLabel }) =>
  h("input", {
    value,
    disabled: !editable,
    "aria-label": accessibilityLabel,
    onInput: (event) => onChangeText(event.target.value),
  });
