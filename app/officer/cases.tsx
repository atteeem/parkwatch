import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, Image, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { radius, shadow, BOTTOM_NAV_HEIGHT } from "../../src/constants/spacing";
import { OfficerBottomNav } from "../../src/components/OfficerBottomNav";
import { StatusChip } from "../../src/components/StatusChip";
import { useApp } from "../../src/context/AppContext";
import { caseChip, CasesTab, casesStats, filterCasesTab, myCases, sortCases } from "../../src/presentation/officerViews";

const TABS: readonly CasesTab[] = ["All", "Completed", "Issued", "Rejected"];

const EMPTY_TEXT: Record<CasesTab, string> = {
  All: "No cases yet. Cases you accept or decide appear here.",
  Completed: "No completed cases yet.",
  Issued: "No parking charges issued yet.",
  Rejected: "No rejected reports.",
};

// OFF-10: this officer's cases (assigned to or decided by them), newest first.
export default function MyCases() {
  const router = useRouter();
  const { officerCases, officerId } = useApp();
  const [tab, setTab] = useState<CasesTab>("All");

  const mine = myCases(officerCases, officerId);
  const stats = casesStats(mine);
  const list = sortCases(filterCasesTab(mine, tab), "NEWEST");

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerRow}>
        <View style={{ alignItems: "center", flex: 1 }}>
          <Text style={styles.title}>My Cases</Text>
          <Text style={styles.subtitle}>View your inspection history</Text>
        </View>
      </View>

      <View style={styles.tabsRow}>
        {TABS.map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={styles.tab}>
            <Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>{t}</Text>
            {tab === t && <View style={styles.tabUnderline} />}
          </Pressable>
        ))}
      </View>

      <View style={styles.statsCard}>
        {[
          { icon: "clipboard", value: String(stats.total), label: "Total cases", color: colors.greenDark },
          { icon: "checkmark-circle", value: String(stats.completed), label: "Completed", color: colors.greenDark },
          { icon: "document-text", value: String(stats.issued), label: "Charges issued", color: colors.blue },
          { icon: "close-circle", value: String(stats.rejected), label: "Rejected", color: colors.red },
        ].map((s) => (
          <View key={s.label} style={{ alignItems: "center", flex: 1 }}>
            <Ionicons name={s.icon as any} size={18} color={s.color} />
            <Text style={styles.statValue}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: BOTTOM_NAV_HEIGHT + 20 }}>
        {list.length === 0 && <Text style={styles.emptyText}>{EMPTY_TEXT[tab]}</Text>}
        {list.map((c) => {
          const chip = caseChip(c);
          const charged = c.outcomeCode === "CHARGE_ISSUED" && c.chargeAmount !== undefined;
          return (
            <Pressable
              key={c.id}
              style={styles.caseCard}
              onPress={() => router.push({ pathname: "/officer/report-details", params: { id: c.id } })}
            >
              <Image source={{ uri: c.images[0] }} style={styles.caseImg} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.plate}>{c.plate}</Text>
                <Text style={styles.meta}>
                  <Ionicons name="location" size={11} /> {c.location}
                </Text>
                <Text style={styles.meta}>
                  <Ionicons name="calendar" size={11} /> {c.reportedAgo}
                </Text>
                <Text style={styles.meta}>
                  <Ionicons name="chatbubble-outline" size={11} /> {c.violation}
                </Text>
                <View style={styles.idChip}>
                  <Text style={styles.idChipLabel}>Report ID #{c.reportId}</Text>
                </View>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <StatusChip status={chip.status} label={chip.label} tone={chip.tone} />
                {charged ? (
                  <>
                    <Text style={styles.chargeAmount}>
                      {"€"}
                      {c.chargeAmount}
                    </Text>
                    <Text style={styles.chargeLabel}>Parking charge</Text>
                  </>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      <OfficerBottomNav />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  emptyText: { color: colors.textSecondary, fontSize: 13, textAlign: "center", marginTop: 20 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingHorizontal: 20, paddingTop: 6 },
  title: { fontSize: 19, fontWeight: "800" },
  subtitle: { fontSize: 11.5, color: colors.textSecondary, marginTop: 2 },
  tabsRow: { flexDirection: "row", gap: 20, paddingHorizontal: 20, marginTop: 16 },
  tab: { paddingBottom: 8 },
  tabLabel: { fontSize: 14, fontWeight: "600", color: colors.textLight },
  tabLabelActive: { color: colors.greenDark, fontWeight: "800" },
  tabUnderline: { height: 2.5, backgroundColor: colors.green, borderRadius: 2, marginTop: 6 },
  statsCard: {
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
  statValue: { fontSize: 16, fontWeight: "800", marginTop: 4 },
  statLabel: { fontSize: 9.5, color: colors.textSecondary, textAlign: "center", marginTop: 2 },
  caseCard: { flexDirection: "row", backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 14, marginBottom: 12, ...shadow.card },
  caseImg: { width: 60, height: 60, borderRadius: radius.photo },
  plate: { fontWeight: "800", fontSize: 16.5 },
  meta: { fontSize: 11.5, color: colors.textSecondary, marginTop: 3 },
  idChip: { backgroundColor: colors.greenLight, borderRadius: radius.chip, paddingHorizontal: 8, paddingVertical: 3, alignSelf: "flex-start", marginTop: 6 },
  idChipLabel: { fontSize: 10.5, fontWeight: "700", color: colors.greenDark },
  chargeAmount: { fontWeight: "800", fontSize: 17, marginTop: 8 },
  chargeLabel: { fontSize: 10.5, color: colors.textLight },
});
