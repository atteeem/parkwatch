import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { radius, shadow, BOTTOM_NAV_HEIGHT } from "../../src/constants/spacing";
import { OfficerBottomNav } from "../../src/components/OfficerBottomNav";
import { Card } from "../../src/components/Card";
import { SettingsRow } from "../../src/components/SettingsRow";
import { DemoTools } from "../../src/components/DemoTools";
import { useApp } from "../../src/context/AppContext";
import { useAuth } from "../../src/auth/AuthContext";
import { displayIdentity } from "../../src/auth/identity";
import { SignOutRow } from "../../src/components/SignOutRow";
import { Avatar } from "../../src/components/Avatar";
import { casesStats, myCases } from "../../src/presentation/officerViews";

export default function OfficerProfile() {
  const router = useRouter();
  const me = displayIdentity(useAuth().state, "officer");
  // Shell profile: real counts from this officer's cases only (no gamification,
  // no response-time stats; those need server timestamps).
  const { officerCases, officerId } = useApp();
  const mine = myCases(officerCases, officerId);
  const all = casesStats(mine);
  const today = new Date().toDateString();
  const todays = casesStats(mine.filter((c) => c.completedAt && new Date(c.completedAt).toDateString() === today));

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Officer Profile</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: BOTTOM_NAV_HEIGHT + 20 }}>
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Avatar name={me.fullName} size={64} />
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={styles.name}>{me.fullName}</Text>
              {me.source === "DEMO" ? (
                <>
                  <Text style={styles.role}>{me.demo?.unit}</Text>
                  <View style={styles.onDutyChip}>
                    <View style={styles.onDutyDot} />
                    <Text style={styles.onDutyLabel}>On Duty</Text>
                  </View>
                  <Text style={styles.officerId}>{me.demo?.badge}</Text>
                  <Text style={styles.verifiedLine}>
                    <Ionicons name="shield-checkmark" size={12} color={colors.greenDark} /> Verified officer (demo)
                  </Text>
                  <Text style={styles.authorizedLine}>Demo identity</Text>
                </>
              ) : (
                <>
                  {!!me.email && <Text style={styles.role}>{me.email}</Text>}
                  {/* Only what the server confirmed: active enforcement membership. */}
                  <Text style={styles.verifiedLine}>
                    <Ionicons name="shield-checkmark" size={12} color={colors.greenDark} /> Active enforcement member
                  </Text>
                  <Text style={styles.authorizedLine}>{(me.activeOrganizations ?? []).join(", ")}</Text>
                </>
              )}
            </View>

          </View>
        </Card>

        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 20, marginBottom: 10 }}>
          <Text style={styles.sectionHeading}>Your Performance</Text>
          <Text style={styles.allTime}>
            All Time
          </Text>
        </View>
        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            {[
              { icon: "document-text", value: String(all.total), label: "My Cases", color: colors.blue },
              { icon: "checkmark-circle", value: String(all.completed), label: "Completed Cases", color: colors.greenDark },
              { icon: "wallet", value: String(all.issued), label: "Parking Charges Issued", color: "#B47A00" },
              { icon: "close-circle", value: String(all.rejected), label: "Rejected Reports", color: colors.purple },
            ].map((s) => (
              <View key={s.label} style={{ alignItems: "center", flex: 1 }}>
                <Ionicons name={s.icon as any} size={18} color={s.color} />
                <Text style={styles.perfValue}>{s.value}</Text>
                <Text style={styles.perfLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        </Card>

        <Card style={{ marginTop: 16 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={styles.sectionHeading}>Today's Shift</Text>
            <View style={styles.onDutyChip}>
              <Text style={styles.onDutyLabel}>On Duty</Text>
            </View>
          </View>
          <Text style={styles.shiftTime}>Cases you closed today</Text>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 14 }}>
            {[
              { value: String(todays.completed), label: "Cases Completed" },
              { value: String(todays.issued), label: "Charges Issued" },
              { value: String(todays.rejected), label: "Rejected Reports" },
            ].map((s) => (
              <View key={s.label} style={{ alignItems: "center", flex: 1 }}>
                <Text style={styles.perfValue}>{s.value}</Text>
                <Text style={styles.perfLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        </Card>

        <Text style={styles.sectionLabel}>ACCOUNT</Text>
        <Card noPadding>
          <SettingsRow icon="person" title="Personal Information" unavailable />
          <View style={styles.divider} />
          <SettingsRow icon="location" title="Assigned District" subtitle={me.demo?.district ?? "Set by your organization"} />
          <View style={styles.divider} />
          <SettingsRow icon="car" title="Work Vehicle" subtitle={me.source === "DEMO" ? "Service van 1" : "Set by your organization"} />
          <View style={styles.divider} />
          <SettingsRow icon="hardware-chip" title="Equipment Status" unavailable />
        </Card>

        <Text style={styles.sectionLabel}>PERFORMANCE</Text>
        <Card noPadding>
          <SettingsRow icon="stats-chart" title="Monthly Statistics" unavailable />
          <View style={styles.divider} />
          <SettingsRow icon="folder" title="Case History" subtitle="View your inspection history" onPress={() => router.replace("/officer/cases")} />
        </Card>

        <Text style={styles.sectionLabel}>APP</Text>
        <Card noPadding>
          <SettingsRow icon="notifications" title="Notifications" subtitle="Case updates and alerts" onPress={() => router.push("/officer/notifications")} />
          <View style={styles.divider} />
          <SettingsRow icon="moon" title="Dark Mode" subtitle="Not available in demo · light theme only" unavailable />
          <View style={styles.divider} />
          <SettingsRow icon="help-circle" title="Help & Support" unavailable />
          <View style={styles.divider} />
          <SignOutRow />
        </Card>
        <DemoTools />
      </ScrollView>
      <OfficerBottomNav />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  headerRow: { alignItems: "center", paddingTop: 6, paddingBottom: 6 },
  title: { fontSize: 19, fontWeight: "800" },
  avatar: { width: 64, height: 64, borderRadius: 32 },
  name: { fontSize: 17, fontWeight: "800" },
  role: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  onDutyChip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.greenLight, borderRadius: radius.chip, paddingHorizontal: 9, paddingVertical: 3, alignSelf: "flex-start", marginTop: 6 },
  onDutyDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.greenDark },
  onDutyLabel: { fontSize: 10.5, fontWeight: "700", color: colors.greenDark },
  officerId: { fontSize: 11, color: colors.textLight, marginTop: 6 },
  verifiedLine: { fontSize: 11.5, fontWeight: "700", color: colors.greenDark, marginTop: 4 },
  authorizedLine: { fontSize: 10.5, color: colors.textLight, marginTop: 2 },
  editBtn: { flexDirection: "row", gap: 4, alignItems: "center", borderWidth: 1, borderColor: colors.green, borderRadius: radius.chip, paddingHorizontal: 10, paddingVertical: 6 },
  editLabel: { fontSize: 11, fontWeight: "700", color: colors.greenDark },
  sectionHeading: { fontSize: 16, fontWeight: "800" },
  allTime: { fontSize: 12, fontWeight: "700", color: colors.textSecondary },
  perfValue: { fontSize: 15, fontWeight: "800", marginTop: 6 },
  perfLabel: { fontSize: 9.5, color: colors.textSecondary, textAlign: "center", marginTop: 2 },
  shiftTime: { fontSize: 11.5, color: colors.textSecondary, marginTop: 4 },
  viewShiftDetails: { color: colors.greenDark, fontWeight: "700", fontSize: 13 },
  sectionLabel: { fontSize: 11.5, fontWeight: "700", color: colors.textLight, marginTop: 18, marginBottom: 8, marginLeft: 2 },
  row: { flexDirection: "row", alignItems: "center", padding: 14 },
  rowIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.greenLight, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontWeight: "700", fontSize: 14 },
  rowSubtitle: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.borderLight, marginLeft: 60 },
});
