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

const TABS = ["All", "Completed", "Issued", "Rejected"] as const;

export default function MyCases() {
  const router = useRouter();
  const { officerCases } = useApp();
  const [tab, setTab] = useState<(typeof TABS)[number]>("All");

  const completed = officerCases.filter((c) => c.status === "completed");
  const issued = completed.filter((c) => c.chargeAmount);
  const rejected = officerCases.filter((c) => c.status === "rejected");

  const list =
    tab === "Completed" ? completed : tab === "Issued" ? issued : tab === "Rejected" ? rejected : officerCases;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerRow}>
        <Ionicons name="menu" size={20} color={colors.textPrimary} />
        <View style={{ alignItems: "center" }}>
          <Text style={styles.title}>My Cases</Text>
          <Text style={styles.subtitle}>View your inspection history</Text>
        </View>
        <Ionicons name="filter" size={20} color={colors.textPrimary} />
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
          { icon: "clipboard", value: String(officerCases.length), label: "Total cases", color: colors.greenDark },
          { icon: "checkmark-circle", value: String(completed.length), label: "Completed", color: colors.greenDark },
          { icon: "document-text", value: String(issued.length), label: "Charges issued", color: colors.blue },
          { icon: "close-circle", value: String(rejected.length), label: "Rejected", color: colors.red },
        ].map((s) => (
          <View key={s.label} style={{ alignItems: "center", flex: 1 }}>
            <Ionicons name={s.icon as any} size={18} color={s.color} />
            <Text style={styles.statValue}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: BOTTOM_NAV_HEIGHT + 20 }}>
        {list.map((c) => (
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
              <StatusChip label={c.chargeAmount ? "Charge issued" : c.status === "completed" ? "Closed" : "Rejected"} tone={c.chargeAmount ? "green" : "grey"} />
              {c.chargeAmount ? (
                <>
                  <Text style={styles.chargeAmount}>{"\u20ac"}{c.chargeAmount}</Text>
                  <Text style={styles.chargeLabel}>Parking charge</Text>
                </>
              ) : null}
            </View>
          </Pressable>
        ))}
      </ScrollView>
      <OfficerBottomNav />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
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
