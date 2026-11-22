import { radius, size, space, typography, type Palette } from "@vetx/design-tokens";
import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

export const createStyles = (palette: Palette) =>
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
    row: {
      gap: space.compact,
      paddingVertical: space.inline,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.line,
    },
    field: {
      color: palette.ink,
      backgroundColor: palette.paper,
      borderWidth: 1,
      borderColor: palette.muted,
      minHeight: size.touch,
      borderRadius: radius.control,
      paddingHorizontal: space.inline,
      paddingVertical: space.compact,
      fontSize: typography.body,
    },
    focus: { borderColor: palette.focus, borderWidth: 2 },
    actionFocus: { outlineColor: palette.focus, outlineWidth: 2, outlineOffset: 2 },
    warning: { color: palette.warning },
  });

export type AccessStyles = ReturnType<typeof createStyles>;

export function Action({
  label,
  onPress,
  styles,
  primary = false,
  busy = false,
  disabled = false,
  role = "button",
  selected,
  accessibilityLabel,
  destructive = false,
}: {
  label: string;
  onPress: () => void;
  styles: AccessStyles;
  primary?: boolean;
  busy?: boolean;
  disabled?: boolean;
  role?: "button" | "radio" | "checkbox";
  selected?: boolean;
  accessibilityLabel?: string;
  destructive?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityState={{
        busy,
        disabled: disabled || busy,
        checked: role !== "button" ? selected : undefined,
      }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        (primary || selected) && styles.actionPrimary,
        focused && styles.actionFocus,
        (pressed || busy || disabled) && styles.actionPressed,
      ]}
    >
      <Text
        style={[
          styles.actionText,
          (primary || selected) && styles.actionPrimaryText,
          destructive && styles.warning,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
