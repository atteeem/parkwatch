import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../constants/colors";
import { radius, shadow } from "../constants/spacing";
import { OfficerCase } from "../data/types";
import { VehicleThumbnail } from "./VehicleThumbnail";
import { StatusChip } from "./StatusChip";

export function CaseCard({ item, onPress }: { item: OfficerCase; onPress?: () => void }) {
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
        <Text style={styles.metaSmall}>
          {item.distance.toFixed(1)} km away {"\u00b7"} {item.reportedAgo}
        </Text>
      </View>
      <View style={styles.right}>
        <StatusChip status={item.status} />
        <Ionicons name="chevron-forward" size={18} color={colors.textLight} style={{ marginTop: 8 }} />
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
  topRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  plate: { fontSize: 16.5, fontWeight: "800", color: colors.textPrimary },
  violation: { fontSize: 13.5, fontWeight: "600", color: colors.textSecondary, marginTop: 3 },
  meta: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  metaSmall: { fontSize: 11.5, color: colors.textLight, marginTop: 3 },
  right: { alignItems: "flex-end", justifyContent: "space-between" },
});
