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
import { usePagedList, useApp, useQueuePosition } from "../../src/context/AppContext";
import { ListFooter, listSettledEmpty, useCoreRefreshControl } from "../../src/components/CoreDataGate";
import { useForegroundLocation } from "../../src/location/useForegroundLocation";
import { EmptyFromCopy } from "../../src/components/EmptyState";
import { AnimatedPressable } from "../../src/components/motion/AnimatedPressable";
import { ActiveIndicator } from "../../src/components/motion/ActiveIndicator";
import { FadeIn } from "../../src/components/motion/FadeIn";
import { queueEmpty } from "../../src/presentation/emptyStates";
import {
  QueueFilter,
  sortQueue,
  withDistances,
} from "../../src/presentation/officerViews";

const FILTERS: readonly QueueFilter[] = ["All", "New", "High Priority", "Assigned"];

export default function ReportQueue() {
  const router = useRouter();
  const { officerSummary } = useApp();
  const refreshControl = useCoreRefreshControl();
  const [filter, setFilter] = useState<QueueFilter>("All");
  // Never prompts; distances only when permission was already granted.
  const location = useForegroundLocation();
  const officerFix = location.permission === "granted" ? location.fix : undefined;

  useQueuePosition(officerFix);
  // Filtered (and nearest-first ordered) on the server before paging; counts from the server.
  const list = usePagedList({ kind: "queue", filter });
  const summary = { newCount: officerSummary.newCount, highPriorityCount: officerSummary.highPriorityNew, assignedToMeCount: officerSummary.assignedToMe };
  const shown = sortQueue(withDistances(list.items, officerFix));
  const empty = listSettledEmpty(list) ? queueEmpty(filter, officerSummary.open) : null;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
        <Text style={typography.screenTitle}>Report Queue</Text>
        <Text style={typography.screenSubtitle}>Incoming parking reports near you</Text>
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <AnimatedPressable
            key={f}
            onPress={() => setFilter(f)}
            style={[styles.filterPill, filter === f && styles.filterPillSelected]}
            accessibilityRole="tab"
            accessibilityState={{ selected: filter === f }}
          >
            <ActiveIndicator active={filter === f} style={styles.filterPillActive} />
            <Text style={[styles.filterLabel, filter === f && styles.filterLabelActive]}>{f}</Text>
          </AnimatedPressable>
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

      <ScrollView refreshControl={refreshControl} contentContainerStyle={{ padding: 20, paddingBottom: BOTTOM_NAV_HEIGHT + 20 }}>
        {empty && <EmptyFromCopy key={filter} copy={empty} onAction={() => setFilter("All")} />}
        {shown.length > 0 && (
          <FadeIn key={filter}>
            {shown.map((c) => (
              <CaseCard
                key={c.id}
                item={c}
                distanceMeters={c.distanceMeters}
                onPress={() => router.push({ pathname: "/officer/report-details", params: { id: c.id } })}
              />
            ))}
          </FadeIn>
        )}
        <ListFooter list={list} />
      </ScrollView>
      <OfficerBottomNav />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  filterRow: { flexDirection: "row", gap: 8, paddingHorizontal: 20, marginTop: 14, flexWrap: "wrap" },
  filterPill: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.chip, paddingHorizontal: 12, paddingVertical: 8 },
  filterPillSelected: { borderColor: colors.green },
  filterPillActive: { position: "absolute", top: -1, left: -1, right: -1, bottom: -1, borderRadius: radius.chip, backgroundColor: colors.green },
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
