import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../constants/colors";
import { radius, shadow } from "../constants/spacing";
import { UserReport, violationLabel } from "../data/types";
import { VehicleThumbnail } from "./VehicleThumbnail";
import { StatusChip } from "./StatusChip";

function formatDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " at " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function ReportCard({ report, onPress }: { report: UserReport; onPress?: () => void }) {
  const rewardLabel =
    report.rewardState === "rewarded"
      ? "Rewarded"
      : report.rewardState === "none"
      ? "No reward"
      : "Estimated";

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
      <VehicleThumbnail uri={report.images[0]} size={60} radius={14} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <StatusChip status={report.status} />
        <Text style={styles.title} numberOfLines={1}>
          {violationLabel(report.violation)}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          <Ionicons name="location" size={11} color={colors.textSecondary} /> {report.location}
        </Text>
        <Text style={styles.metaSmall} numberOfLines={1}>
          #{report.id} {"\u2022"} {formatDate(report.submittedAt)}
        </Text>
      </View>
      <View style={styles.right}>
        <Ionicons name="chevron-forward" size={18} color={colors.textLight} />
        {report.reward !== undefined && report.rewardState !== "none" ? (
          <Text style={styles.reward}>{"\u20ac"}{report.reward.toFixed(2)}</Text>
        ) : (
          <Text style={styles.rewardNone}>{"\u2014"}</Text>
        )}
        <Text style={styles.rewardLabel}>{rewardLabel}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: 14,
    marginBottom: 12,
    ...shadow.card,
  },
  title: { fontSize: 15.5, fontWeight: "700", color: colors.textPrimary, marginTop: 6 },
  meta: { fontSize: 12.5, color: colors.textSecondary, marginTop: 3 },
  metaSmall: { fontSize: 11.5, color: colors.textLight, marginTop: 2 },
  right: { alignItems: "flex-end", justifyContent: "space-between", marginLeft: 8 },
  reward: { fontSize: 16, fontWeight: "800", color: colors.greenDark, marginTop: 10 },
  rewardNone: { fontSize: 16, fontWeight: "800", color: colors.textLight, marginTop: 10 },
  rewardLabel: { fontSize: 10.5, color: colors.textLight, fontWeight: "600" },
});
