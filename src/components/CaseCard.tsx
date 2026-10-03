import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../constants/colors";
import { radius, shadow } from "../constants/spacing";
import { OfficerCase } from "../data/types";
import { formatDistance } from "../geo/distance";
import { VehicleThumbnail } from "./VehicleThumbnail";
import { StatusChip } from "./StatusChip";

/**
 * Officer case card. Distance is the straight-line distance from the
 * officer's real position, shown ONLY when known (never a mock value).
 */
export function CaseCard({
  item,
  distanceMeters,
  onPress,
}: {
  item: OfficerCase;
  distanceMeters?: number | null;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
      <VehicleThumbnail uri={item.images[0]} size={58} radius={14} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <View style={styles.topRow}>
          <Text style={styles.plate}>{item.plate}</Text>
          {item.priority === "high" && <StatusChip status="high" />}
        </View>
        <Text style={styles.violation} numberOfLines={1}>
          {item.violation}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          <Ionicons name="location" size={11} color={colors.textSecondary} /> {item.location}
        </Text>
        <Text style={styles.metaSmall} numberOfLines={1}>
          {item.reportedAgo} {"·"} {item.photoCount} photos
          {distanceMeters != null ? ` · ${formatDistance(distanceMeters)} away` : ""}
        </Text>
        <Text style={styles.reliability} numberOfLines={1}>
          <Ionicons name="shield-checkmark" size={10} color={colors.greenDark} /> Reporter reliability: {item.reporterReliability}
        </Text>
      </View>
      <View style={styles.right}>
        <StatusChip status={item.status} />
        <View style={styles.viewCase}>
          <Text style={styles.viewCaseLabel}>View Case</Text>
          <Ionicons name="chevron-forward" size={12} color="#06210F" />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 12,
    ...shadow.card,
  },
  topRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  plate: { fontSize: 16, fontWeight: "800", color: colors.textPrimary },
  violation: { fontSize: 13, fontWeight: "600", color: colors.textPrimary, marginTop: 2 },
  meta: { fontSize: 12, color: colors.textSecondary, marginTop: 3 },
  metaSmall: { fontSize: 11, color: colors.textLight, marginTop: 2 },
  reliability: { fontSize: 11, color: colors.greenDark, fontWeight: "600", marginTop: 2 },
  right: { alignItems: "flex-end", justifyContent: "space-between", alignSelf: "stretch", marginLeft: 8, gap: 8 },
  viewCase: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: colors.green,
    borderRadius: radius.chip,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  viewCaseLabel: { fontSize: 11.5, fontWeight: "700", color: "#06210F" },
});
