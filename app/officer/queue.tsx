import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { typography } from "../../src/constants/typography";
import { radius, shadow, BOTTOM_NAV_HEIGHT } from "../../src/constants/spacing";
import { OfficerBottomNav } from "../../src/components/OfficerBottomNav";
import { CaseCard } from "../../src/components/CaseCard";
import { useApp } from "../../src/context/AppContext";
import { useForegroundLocation } from "../../src/location/useForegroundLocation";
import {
  filterQueue,
  queueEmptyMessage,
  QueueFilter,
  queueSummary,
  sortQueue,
  withDistances,
} from "../../src/presentation/officerViews";

const FILTERS: readonly QueueFilter[] = ["All", "New", "High Priority", "Assigned"];

export default function ReportQueue() {
  const router = useRouter();
  const { officerCases, officerId } = useApp();
  const [filter, setFilter] = useState<QueueFilter>("All");
  // Never prompts; distances only when permission was already granted.
  const location = useForegroundLocation();
  const officerFix = location.permission === "granted" ? location.fix : undefined;

  const summary = queueSummary(officerCases, officerId);
  const withDist = withDistances(officerCases, officerFix);
  const totalOpen = filterQueue(withDist, "All", officerId).length;
  const shown = sortQueue(filterQueue(withDist, filter, officerId));
  const empty = queueEmptyMessage(filter, totalOpen, shown.length);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
        <Text style={typography.screenTitle}>Report Queue</Text>
        <Text style={typography.screenSubtitle}>Incoming parking reports near you</Text>
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <Pressable key={f} onPress={() => setFilter(f)} style={[styles.filterPill, filter === f && styles.filterPillActive]}>
            <Text style={[styles.filterLabel, filter === f && styles.filterLabelActive]}>{f}</Text>
          </Pressable>
        ))}
        {/* Single sort (nearest first); not a dropdown. */}
        <View style={styles.sortPill}>
          <Ionicons name="navigate" size={12} color={colors.textPrimary} />
          <Text style={styles.sortLabel}>Nearest</Text>
        </View>
      </View>
      {!officerFix && (
        <Text style={styles.sortNote}>Location unavailable: sorted by priority, then newest.</Text>
      )}

      <View style={styles.summaryCard}>
        {[
          { icon: "document-text", value: String(summary.newCount), label: "New Reports", tone: colors.greenDark, bg: colors.greenLight },
          { icon: "alert-circle", value: String(summary.highPriorityCount), label: "High Priority", tone: colors.red, bg: colors.redLight },
          { icon: "person", value: String(summary.assignedToMeCount), label: "Assigned to Me", tone: colors.amber, bg: colors.amberLight },
        ].map((s, i) => (
          <React.Fragment key={s.label}>
            <View style={{ alignItems: "center", flex: 1 }}>
              <View style={[styles.summaryIcon, { backgroundColor: s.bg }]}>
                <Ionicons name={s.icon as any} size={16} color={s.tone} />
              </View>
              <Text style={styles.summaryValue}>{s.value}</Text>
              <Text style={styles.summaryLabel}>{s.label}</Text>
            </View>
            {i < 2 && <View style={styles.vDivider} />}
          </React.Fragment>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: BOTTOM_NAV_HEIGHT + 20 }}>
        {empty && (
          <View style={styles.emptyCard}>
            <Ionicons name="checkmark-done" size={22} color={colors.textLight} />
            <Text style={styles.emptyText}>{empty}</Text>
          </View>
        )}
        {shown.map((c) => (
          <CaseCard
            key={c.id}
            item={c}
            distanceMeters={c.distanceMeters}
            onPress={() => router.push({ pathname: "/officer/report-details", params: { id: c.id } })}
          />
        ))}
      </ScrollView>
      <OfficerBottomNav />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  filterRow: { flexDirection: "row", gap: 8, paddingHorizontal: 20, marginTop: 14, flexWrap: "wrap" },
  filterPill: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.chip, paddingHorizontal: 12, paddingVertical: 8 },
  filterPillActive: { backgroundColor: colors.green, borderColor: colors.green },
  filterLabel: { fontSize: 12, fontWeight: "700", color: colors.textPrimary },
  filterLabelActive: { color: "#06210F" },
  sortPill: { flexDirection: "row", alignItems: "center", gap: 4, marginLeft: "auto", paddingHorizontal: 4, paddingVertical: 8 },
  sortLabel: { fontWeight: "700", fontSize: 12.5 },
  sortNote: { fontSize: 11.5, color: colors.textSecondary, paddingHorizontal: 20, marginTop: 6 },
  summaryCard: {
    flexDirection: "row",
    marginHorizontal: 20,
    marginTop: 14,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: 14,
    ...shadow.card,
  },
  summaryIcon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  summaryValue: { fontSize: 17, fontWeight: "800", marginTop: 6 },
  summaryLabel: { fontSize: 10, color: colors.textSecondary, fontWeight: "600", marginTop: 2, textAlign: "center" },
  vDivider: { width: 1, backgroundColor: colors.borderLight },
  emptyCard: {
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: 24,
  },
  emptyText: { fontSize: 13, color: colors.textSecondary, textAlign: "center" },
});
