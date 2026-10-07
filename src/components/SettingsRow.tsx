import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../constants/colors";
import { AnimatedPressable } from "./motion/AnimatedPressable";

/**
 * Default subtitle for a feature that is not built yet. Truthful in both the
 * local demo and the backend build, and promises no release date.
 */
export const NOT_AVAILABLE_YET = "Not available yet";

/**
 * How a settings/profile row behaves. Only "action" rows are pressable and
 * show a chevron; "info" rows just show data; "unavailable" rows are dimmed
 * and say so. No row may look tappable without doing something.
 */
export type RowKind = "action" | "info" | "unavailable";

export function rowKind(props: { onPress?: () => void; unavailable?: boolean }): RowKind {
  if (props.onPress) return "action";
  return props.unavailable ? "unavailable" : "info";
}

type Props = {
  icon: keyof typeof Ionicons.glyphMap;
  iconBg?: string;
  iconColor?: string;
  title: string;
  /** For unavailable rows this defaults to "Not available yet". */
  subtitle?: string;
  /** Present => real action (pressable, chevron). */
  onPress?: () => void;
  /** Future feature that needs backend/accounts: dimmed, not pressable. */
  unavailable?: boolean;
  /** Extra content on the right of an action row (replaces the chevron). */
  right?: React.ReactNode;
  destructive?: boolean;
};

export function SettingsRow({ icon, iconBg = colors.greenLight, iconColor = colors.greenDark, title, subtitle, onPress, unavailable, right, destructive }: Props) {
  const kind = rowKind({ onPress, unavailable });
  const sub = kind === "unavailable" ? subtitle ?? NOT_AVAILABLE_YET : subtitle;
  const body = (
    <>
      <View style={[styles.icon, { backgroundColor: kind === "unavailable" ? colors.backgroundSunk : iconBg }]}>
        <Ionicons name={icon} size={17} color={kind === "unavailable" ? colors.textLight : iconColor} />
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={[styles.title, destructive && kind === "action" && { color: colors.red }, kind === "unavailable" && styles.dimTitle]}>{title}</Text>
        {sub ? <Text style={styles.subtitle}>{sub}</Text> : null}
      </View>
    </>
  );

  if (kind === "action") {
    return (
      <AnimatedPressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={title}>
        {body}
        {right ?? <Ionicons name="chevron-forward" size={16} color={colors.textLight} />}
      </AnimatedPressable>
    );
  }
  // Informational / unavailable: a plain View with no press feedback and no chevron.
  return (
    <View style={styles.row} accessibilityLabel={`${title}${kind === "unavailable" ? ", not available yet" : ""}`}>
      {body}
      {kind === "info" ? right : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", padding: 14 },
  icon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  title: { fontWeight: "700", fontSize: 14.5, color: colors.textPrimary },
  dimTitle: { color: colors.textSecondary },
  subtitle: { fontSize: 11.5, color: colors.textSecondary, marginTop: 2 },
});
