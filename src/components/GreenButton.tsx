import React from "react";
import { Pressable, Text, StyleSheet, ViewStyle, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../constants/colors";
import { radius } from "../constants/spacing";

type Variant = "solid" | "outline" | "gray" | "destructive";

type Props = {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: Variant;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Pass null for no trailing icon. */
  trailingIcon?: keyof typeof Ionicons.glyphMap | null;
  style?: ViewStyle;
  small?: boolean;
};

export function GreenButton({
  label,
  onPress,
  disabled,
  loading,
  variant = "solid",
  icon,
  trailingIcon = "chevron-forward",
  style,
  small,
}: Props) {
  const isSolidDisabled = disabled && variant === "solid";
  return (
    <Pressable
      onPress={disabled || loading ? undefined : onPress}
      style={({ pressed }) => [
        styles.base,
        small && styles.small,
        variant === "solid" && (isSolidDisabled ? styles.solidDisabled : styles.solid),
        variant === "outline" && styles.outline,
        variant === "gray" && styles.gray,
        variant === "destructive" && styles.destructive,
        pressed && !disabled && { opacity: 0.85 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === "solid" ? "#06210F" : colors.textPrimary} />
      ) : (
        <>
          {icon && (
            <Ionicons
              name={icon}
              size={18}
              color={variant === "outline" ? colors.textPrimary : variant === "destructive" ? colors.red : "#06210F"}
              style={{ marginRight: 8 }}
            />
          )}
          <Text
            style={[
              styles.label,
              variant === "outline" && { color: colors.textPrimary },
              variant === "gray" && { color: colors.white },
              variant === "destructive" && { color: colors.red },
            ]}
          >
            {label}
          </Text>
          {trailingIcon && variant === "solid" && !isSolidDisabled && (
            <Ionicons name={trailingIcon} size={18} color="#06210F" style={{ marginLeft: 8 }} />
          )}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.button,
    paddingVertical: 16,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  small: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    width: "auto",
  },
  solid: {
    backgroundColor: colors.green,
  },
  solidDisabled: {
    backgroundColor: colors.backgroundSunk,
  },
  outline: {
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  gray: {
    backgroundColor: "#9AA19C",
  },
  destructive: {
    backgroundColor: colors.redLight,
  },
  label: {
    fontSize: 16,
    fontWeight: "700",
    color: "#06210F",
  },
});
