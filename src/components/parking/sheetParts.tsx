import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../constants/colors";

/** Sheet header: optional back chevron, title, optional subtitle. */
export function SheetHeader({ title, subtitle, onBack, backLabel = "Back" }: { title: string; subtitle?: string; onBack?: () => void; backLabel?: string }) {
  return (
    <View style={styles.header}>
      {onBack && (
        <Pressable onPress={onBack} hitSlop={10} style={styles.back} accessibilityRole="button" accessibilityLabel={backLabel}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      </View>
    </View>
  );
}

/** Area code badge, e.g. "A1" — the strongest element of an area row/detail. */
export function ZoneBadge({ code, large }: { code: string; large?: boolean }) {
  return (
    <View style={[styles.badge, large && styles.badgeLarge]}>
      <Text style={[styles.badgeText, large && styles.badgeTextLarge]}>{code}</Text>
    </View>
  );
}

/** Label/value line in summaries. */
export function FactRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={[styles.factValue, strong && styles.factStrong]}>{value}</Text>
    </View>
  );
}

/** The demo disclosure: shown wherever a session is started, extended or ended. */
export function DemoDisclosure({ compact }: { compact?: boolean }) {
  return (
    <View style={styles.disclosure} accessibilityRole="text">
      <Ionicons name="information-circle" size={18} color={colors.blue} />
      <View style={{ flex: 1 }}>
        <Text style={styles.disclosureTitle}>Demo parking</Text>
        {!compact && <Text style={styles.disclosureText}>This session is stored on this device. No parking operator is contacted and no payment is taken.</Text>}
        {compact && <Text style={styles.disclosureText}>Stored on this device · no operator · no payment.</Text>}
      </View>
    </View>
  );
}

export const sheetStyles = StyleSheet.create({
  cta: {
    marginTop: 16,
    backgroundColor: colors.cardBlack,
    borderRadius: 16,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  ctaDisabled: { backgroundColor: colors.border },
  ctaLabel: { color: colors.white, fontWeight: "800", fontSize: 16 },
  ghost: { alignItems: "center", paddingVertical: 12, marginTop: 4 },
  ghostLabel: { color: colors.textSecondary, fontWeight: "700", fontSize: 14 },
  danger: { backgroundColor: colors.red },
});

/** Full-width primary action at the bottom of a sheet step. */
export function SheetCTA({ label, onPress, disabled, danger, accessibilityHint }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean; accessibilityHint?: string }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [sheetStyles.cta, danger && sheetStyles.danger, disabled && sheetStyles.ctaDisabled, pressed && !disabled && { opacity: 0.85 }]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      accessibilityHint={accessibilityHint}
    >
      <Text style={sheetStyles.ctaLabel}>{label}</Text>
    </Pressable>
  );
}

export function SheetGhost({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={sheetStyles.ghost} accessibilityRole="button" hitSlop={6}>
      <Text style={sheetStyles.ghostLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 },
  back: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", marginLeft: -6 },
  title: { fontSize: 20, fontWeight: "800", color: colors.textPrimary },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  badge: { minWidth: 44, height: 36, paddingHorizontal: 8, borderRadius: 10, backgroundColor: colors.greenLight, alignItems: "center", justifyContent: "center" },
  badgeLarge: { minWidth: 72, height: 56, borderRadius: 14, backgroundColor: colors.cardBlack },
  badgeText: { fontWeight: "800", fontSize: 15, color: colors.greenDark },
  badgeTextLarge: { fontSize: 26, color: colors.white },
  fact: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderLight, gap: 16 },
  factLabel: { fontSize: 13.5, color: colors.textSecondary },
  factValue: { fontSize: 14.5, fontWeight: "700", color: colors.textPrimary, flexShrink: 1, textAlign: "right" },
  factStrong: { fontSize: 17, fontWeight: "800" },
  disclosure: { flexDirection: "row", gap: 10, backgroundColor: colors.blueLight, borderRadius: 14, padding: 12, marginTop: 14 },
  disclosureTitle: { fontWeight: "800", fontSize: 13, color: colors.textPrimary },
  disclosureText: { fontSize: 12.5, color: colors.textPrimary, marginTop: 2, lineHeight: 17 },
});
