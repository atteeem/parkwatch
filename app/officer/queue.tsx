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

const FILTERS = ["All", "New", "High Priority", "Assigned"] as const;

export default function ReportQueue() {
  const router = useRouter();
  const { officerCases } = useApp();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");

  const newCount = officerCases.filter((c) => c.status === "new").length;
  const highCount = officerCases.filter((c) => c.priority === "high" && c.status === "new").length;
  const assignedToMe = officerCases.filter((c) => c.status === "assigned").length;

  const filtered = officerCases.filter((c) => {
    if (["completed", "rejected"].includes(c.status)) return false;
    if (filter === "New") return c.status === "new";
    if (filter === "High Priority") return c.priority === "high";
    if (filter === "Assigned") return c.status === "assigned";
    return true;
  });

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
        <View style={styles.sortPill}>
          <Text style={styles.sortLabel}>Nearest</Text>
          <Ionicons name="chevron-down" size={13} color={colors.textPrimary} />
        </View>
      </View>

      <View style={styles.summaryCard}>
        {[
          { icon: "document-text", value: String(newCount), label: "New Reports", tone: colors.greenDark, bg: colors.greenLight },
          { icon: "alert-circle", value: String(highCount), label: "High Priority", tone: colors.red, bg: colors.redLight },
          { icon: "person", value: String(assignedToMe), label: "Assigned to Me", tone: colors.amber, bg: colors.amberLight },
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
        {filtered.map((c) => (
          <CaseCard key={c.id} item={c} onPress={() => router.push({ pathname: "/officer/report-details", params: { id: c.id } })} />
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
});
