import { radius, size, space, typography, type Palette } from "@vetx/design-tokens";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";

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
    choice: { backgroundColor: palette.paper, borderWidth: 1, borderColor: palette.muted },
    choiceSelected: {
      backgroundColor: palette.control,
      borderWidth: 2,
      borderColor: palette.focus,
    },
    actionPrimary: { backgroundColor: palette.action },
    primaryPressed: { backgroundColor: palette.actionHover },
    secondaryPressed: { outlineColor: palette.focus, outlineWidth: 2, outlineOffset: -2 },
    actionDisabled: { opacity: 0.8 },
    actionText: { color: palette.ink, fontSize: typography.caption, fontWeight: "600" },
    actionPrimaryText: { color: palette.actionInk },
    pending: { flexDirection: "row", alignItems: "center", gap: space.compact },
    support: { flexShrink: 1, color: palette.muted, fontSize: typography.caption },
    error: { color: palette.error, fontSize: typography.caption },
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
    destructive: { color: palette.error },
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
  expanded,
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
  expanded?: boolean;
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
        expanded,
        disabled: disabled || busy,
        checked: role !== "button" ? selected : undefined,
      }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        selected !== undefined && styles.choice,
        selected && styles.choiceSelected,
        primary && styles.actionPrimary,
        pressed && (primary ? styles.primaryPressed : styles.secondaryPressed),
        focused && styles.actionFocus,
        (busy || disabled) && styles.actionDisabled,
      ]}
    >
      <Text
        style={[
          styles.actionText,
          primary && styles.actionPrimaryText,
          destructive && styles.destructive,
        ]}
      >
        {role === "checkbox" && selected ? "✓ " : ""}
        {label}
      </Text>
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChange,
  maxLength,
  disabled,
  styles,
  identifier,
  inputMode,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  disabled: boolean;
  styles: AccessStyles;
  identifier?: boolean;
  inputMode?: TextInputProps["inputMode"];
  multiline?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        inputMode={inputMode}
        autoCapitalize={identifier ? "none" : "sentences"}
        autoCorrect={!identifier}
        editable={!disabled}
        maxLength={maxLength}
        multiline={multiline}
        textAlignVertical={multiline ? "top" : undefined}
        returnKeyType={multiline ? "default" : "done"}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[styles.field, focused && styles.focus]}
      />
    </View>
  );
}
