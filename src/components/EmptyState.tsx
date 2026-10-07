import React from "react";
import { StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../constants/colors";
import { radius, shadow } from "../constants/spacing";
import { GreenButton } from "./GreenButton";
import { FadeIn } from "./motion/FadeIn";

export type EmptyStateProps = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body?: string;
  /** Optional real action; omit when there is nothing useful to do. */
  cta?: { label: string; onPress: () => void };
  /**
   * full: centred block for a whole list area.
   * compact: card-sized, for a section inside a screen.
   * overlay: small floating card on top of a map (does not replace the map).
   */
  variant?: "full" | "compact" | "overlay";
  style?: StyleProp<ViewStyle>;
};

/** One consistent empty state for every list/section (T8.6). Truthful copy only. */
export function EmptyState({ icon, title, body, cta, variant = "full", style }: EmptyStateProps) {
  const compact = variant !== "full";
  return (
    <FadeIn style={[variant === "full" ? styles.full : variant === "compact" ? styles.compact : styles.overlay, style]}>
      <View accessible accessibilityRole="summary" accessibilityLabel={[title, body].filter(Boolean).join(". ")} style={compact ? styles.rowInner : styles.columnInner}>
        <View style={[styles.iconWrap, compact && styles.iconWrapCompact]}>
          <Ionicons name={icon} size={compact ? 18 : 26} color={colors.greenDark} />
        </View>
        <View style={compact ? { flex: 1, marginLeft: 12 } : { alignItems: "center" }}>
          <Text style={[styles.title, compact ? styles.titleCompact : styles.titleFull]}>{title}</Text>
          {body ? <Text style={[styles.body, compact ? null : styles.bodyFull]}>{body}</Text> : null}
        </View>
      </View>
      {cta ? (
        <GreenButton
          label={cta.label}
          small
          variant={compact ? "outline" : "solid"}
          onPress={cta.onPress}
          style={compact ? { marginTop: 12 } : { marginTop: 18, alignSelf: "stretch" }}
        />
      ) : null}
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  full: { alignItems: "center", paddingVertical: 32, paddingHorizontal: 24 },
  compact: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.card, padding: 16 },
  overlay: { backgroundColor: colors.white, borderRadius: radius.card, padding: 14, ...shadow.card },
  columnInner: { alignItems: "center" },
  rowInner: { flexDirection: "row", alignItems: "center" },
  iconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.greenLight, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  iconWrapCompact: { width: 38, height: 38, borderRadius: 19, marginBottom: 0 },
  title: { fontWeight: "800", color: colors.textPrimary },
  titleFull: { fontSize: 17, textAlign: "center" },
  titleCompact: { fontSize: 14.5 },
  body: { fontSize: 12.5, lineHeight: 18, color: colors.textSecondary, marginTop: 3 },
  bodyFull: { fontSize: 13.5, lineHeight: 19, textAlign: "center", marginTop: 6, maxWidth: 300 },
});

/** Render empty-state copy from src/presentation/emptyStates; the screen decides what each action does. */
export function EmptyFromCopy({
  copy,
  onAction,
  variant,
  style,
}: {
  copy: { icon: string; title: string; body: string; action?: { label: string; kind: string } };
  onAction?: (kind: string) => void;
  variant?: EmptyStateProps["variant"];
  style?: StyleProp<ViewStyle>;
}) {
  const action = copy.action;
  return (
    <EmptyState
      icon={copy.icon as EmptyStateProps["icon"]}
      title={copy.title}
      body={copy.body}
      variant={variant}
      style={style}
      cta={action && onAction ? { label: action.label, onPress: () => onAction(action.kind) } : undefined}
    />
  );
}
