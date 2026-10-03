import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { typography } from "../../src/constants/typography";
import { radius, shadow, BOTTOM_NAV_HEIGHT } from "../../src/constants/spacing";
import { UserBottomNav } from "../../src/components/UserBottomNav";
import { useApp } from "../../src/context/AppContext";
import { UserReportStatus } from "../../src/data/types";

const FILTERS: { key: "all" | UserReportStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "under-review", label: "Under Review" },
  { key: "verified", label: "Verified" },
  { key: "rejected", label: "Rejected" },
];

const MARKER_STYLE: Record<UserReportStatus, { bg: string; icon: keyof typeof Ionicons.glyphMap; fg: string }> = {
  verified: { bg: colors.white, icon: "checkmark-circle", fg: colors.greenDark },
  "under-review": { bg: colors.white, icon: "time", fg: "#B47A00" },
  rejected: { bg: colors.white, icon: "close-circle", fg: colors.red },
};

// Fixed relative positions inside the map card so pins look spread out
// without needing a real map SDK for the MVP.
const POSITIONS = [
  { top: 40, left: 60 }, { top: 90, left: 210 }, { top: 150, left: 30 },
  { top: 170, left: 260 }, { top: 210, left: 140 }, { top: 250, left: 200 },
  { top: 260, left: 80 },
];

export default function UserMap() {
  const { userReports } = useApp();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const filtered = filter === "all" ? userReports : userReports.filter((r) => r.status === filter);

  const counts = {
    verified: userReports.filter((r) => r.status === "verified").length,
    "under-review": userReports.filter((r) => r.status === "under-review").length,
    rejected: userReports.filter((r) => r.status === "rejected").length,
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerRow}>
        <View>
          <Text style={typography.screenTitle}>Map</Text>
          <Text style={typography.screenSubtitle}>View your reports on the map</Text>
        </View>
        <Ionicons name="search" size={22} color={colors.textPrimary} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }} style={{ flexGrow: 0, marginVertical: 12 }}>
        <View style={styles.filterPill}>
          <Ionicons name="options" size={14} color={colors.textPrimary} />
          <Text style={styles.filterLabel}>Filters</Text>
        </View>
        {FILTERS.map((f) => (
          <Pressable key={f.key} onPress={() => setFilter(f.key)} style={[styles.filterPill, filter === f.key && styles.filterPillActive]}>
            <Text style={[styles.filterLabel, filter === f.key && styles.filterLabelActive]}>{f.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.mapWrap}>
        {filtered.map((r, i) => {
          const pos = POSITIONS[i % POSITIONS.length];
          const m = MARKER_STYLE[r.status];
          return (
            <View key={r.id} style={[styles.marker, { top: pos.top, left: pos.left, backgroundColor: m.bg }]}>
              <Ionicons name={m.icon} size={16} color={m.fg} />
            </View>
          );
        })}
        <View style={styles.recenterBtn}>
          <Ionicons name="locate" size={18} color={colors.textPrimary} />
        </View>
      </View>

      <View style={styles.summaryCard}>
        <Ionicons name="map" size={20} color={colors.greenDark} />
        <View style={{ marginLeft: 10 }}>
          <Text style={styles.summaryTitle}>{userReports.length} Reports on Map</Text>
          <Text style={styles.summarySub}>
            {counts.verified} Verified {"\u2022"} {counts["under-review"]} Under Review {"\u2022"} {counts.rejected} Rejected
          </Text>
        </View>
      </View>

      <UserBottomNav />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingHorizontal: 20, paddingTop: 4 },
  filterPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.chip,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  filterPillActive: { backgroundColor: colors.greenLight, borderColor: colors.green },
  filterLabel: { fontSize: 12.5, fontWeight: "700", color: colors.textPrimary },
  filterLabelActive: { color: colors.greenDark },
  mapWrap: {
    flex: 1,
    marginHorizontal: 20,
    borderRadius: radius.cardLg,
    backgroundColor: "#E7EDE8",
    overflow: "hidden",
    marginBottom: 12,
  },
  marker: {
    position: "absolute",
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.card,
  },
  recenterBtn: {
    position: "absolute",
    right: 14,
    bottom: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    ...shadow.card,
  },
  summaryCard: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 20,
    marginBottom: BOTTOM_NAV_HEIGHT + 10,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: 14,
    ...shadow.prominent,
  },
  summaryTitle: { fontWeight: "800", fontSize: 14.5 },
  summarySub: { fontSize: 11.5, color: colors.textSecondary, marginTop: 2 },
});
