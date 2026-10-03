import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { typography } from "../../src/constants/typography";
import { radius, BOTTOM_NAV_HEIGHT } from "../../src/constants/spacing";
import { UserBottomNav } from "../../src/components/UserBottomNav";
import { ReportCard } from "../../src/components/ReportCard";
import { useApp } from "../../src/context/AppContext";
import { useReportDraft } from "../../src/context/ReportContext";
import { UserReportStatus } from "../../src/data/types";

const TABS: { key: "all" | UserReportStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "under-review", label: "Under Review" },
  { key: "verified", label: "Verified" },
  { key: "rejected", label: "Rejected" },
];

export default function MyReports() {
  const router = useRouter();
  const { userReports } = useApp();
  const { startNewReport } = useReportDraft();
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("all");

  const filtered = tab === "all" ? userReports : userReports.filter((r) => r.status === tab);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerRow}>
        <Text style={typography.screenTitle}>My Reports</Text>
        <View style={{ flexDirection: "row", gap: 14 }}>
          <Ionicons name="search" size={20} color={colors.textPrimary} />
          <Ionicons name="filter" size={20} color={colors.textPrimary} />
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 20 }} style={{ flexGrow: 0 }}>
        {TABS.map((t) => (
          <Pressable key={t.key} onPress={() => setTab(t.key)} style={styles.tab}>
            <Text style={[styles.tabLabel, tab === t.key && styles.tabLabelActive]}>{t.label}</Text>
            {tab === t.key && <View style={styles.tabUnderline} />}
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: BOTTOM_NAV_HEIGHT + 90 }}>
        {filtered.map((r) => (
          <ReportCard key={r.id} report={r} onPress={() => router.push({ pathname: "/user/report/report-overview", params: { id: r.id } })} />
        ))}

        <View style={styles.thanksBanner}>
          <View style={{ flex: 1 }}>
            <Text style={styles.thanksTitle}>Thanks for helping!</Text>
            <Text style={styles.thanksBody}>Your reports make our streets safer and more accessible.</Text>
          </View>
        </View>
      </ScrollView>

      <Pressable
        style={styles.fab}
        onPress={() => {
          startNewReport();
          router.push("/user/report/photos");
        }}
      >
        <Ionicons name="add" size={26} color="#06210F" />
      </Pressable>

      <UserBottomNav />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingHorizontal: 20, paddingTop: 4, paddingBottom: 10 },
  tab: { paddingBottom: 10 },
  tabLabel: { fontSize: 15, fontWeight: "600", color: colors.textLight },
  tabLabelActive: { color: colors.greenDark, fontWeight: "800" },
  tabUnderline: { height: 2.5, backgroundColor: colors.green, borderRadius: 2, marginTop: 6 },
  thanksBanner: {
    backgroundColor: colors.greenLight,
    borderRadius: radius.card,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
  thanksTitle: { fontWeight: "800", fontSize: 14.5, color: "#0B7A38" },
  thanksBody: { fontSize: 12, color: "#0B7A38", marginTop: 2 },
  fab: {
    position: "absolute",
    right: 20,
    bottom: BOTTOM_NAV_HEIGHT + 16,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
});
