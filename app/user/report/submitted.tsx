import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../../src/constants/colors";
import { radius } from "../../../src/constants/spacing";
import { GreenButton } from "../../../src/components/GreenButton";
import { Card } from "../../../src/components/Card";
import { StatusChip } from "../../../src/components/StatusChip";
import { useApp } from "../../../src/context/AppContext";
import { toSubmittedSummary } from "../../../src/presentation/citizenViews";

// CIT-06: confirmation only. There is deliberately no submit action here, and
// the finished wizard is no longer in the back stack (Review dismissed to Home).
export default function ReportSubmitted() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getCitizenReport, dataSource, coreStatus, refreshCore } = useApp();
  const report = getCitizenReport(id);

  // Server mode: the report was accepted but the refreshed list hasn't arrived
  // (e.g. the connection dropped right after). Offer to load it, don't claim "not found".
  if (!report && dataSource === "BACKEND" && id) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={{ flex: 1, padding: 24, alignItems: "center", justifyContent: "center", gap: 12 }}>
          <Ionicons name="cloud-download-outline" size={40} color={colors.textSecondary} />
          <Text style={styles.title}>Loading report #{id}…</Text>
          <GreenButton
            label={coreStatus.refreshing ? "Loading…" : "Try Again"}
            loading={coreStatus.refreshing}
            disabled={coreStatus.refreshing}
            onPress={() => void refreshCore()}
            style={{ alignSelf: "stretch" }}
          />
          <GreenButton label="View My Reports" variant="outline" onPress={() => router.replace("/user/reports")} style={{ alignSelf: "stretch" }} />
        </View>
      </SafeAreaView>
    );
  }

  if (!report) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={{ flex: 1, padding: 24, alignItems: "center", justifyContent: "center", gap: 12 }}>
          <Ionicons name="document-text-outline" size={40} color={colors.textSecondary} />
          <Text style={styles.title}>Report not found</Text>
          <GreenButton label="View My Reports" onPress={() => router.replace("/user/reports")} style={{ alignSelf: "stretch" }} />
        </View>
      </SafeAreaView>
    );
  }

  const summary = toSubmittedSummary(report);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={{ flex: 1, padding: 24, alignItems: "center" }}>
        <View style={styles.successCircle}>
          <Ionicons name="checkmark" size={40} color={colors.greenDark} />
        </View>
        <Text style={styles.title}>Report Submitted!</Text>
        <Text style={styles.subtitle}>
          Thank you for helping keep our streets safe and accessible.
        </Text>

        <Card style={{ width: "100%", marginTop: 22 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View>
              <Text style={styles.rowLabel}>Report ID</Text>
              <Text style={styles.reportId}>#{summary.id}</Text>
            </View>
            <StatusChip label={summary.statusLabel} tone="green" />
          </View>
          <View style={styles.divider} />
          {[
            { icon: "calendar-outline", label: "Submitted on", value: summary.submittedOn },
            { icon: "location-outline", label: "Location", value: summary.location },
            { icon: "car-outline", label: "Vehicle", value: summary.vehicle },
            { icon: "ban-outline", label: "Violation", value: summary.violation },
          ].map((row) => (
            <View key={row.label} style={styles.metaRow}>
              <Ionicons name={row.icon as any} size={16} color={colors.greenDark} />
              <Text style={styles.metaLabel}>{row.label}</Text>
              <Text style={styles.metaValue} numberOfLines={1}>
                {row.value}
              </Text>
            </View>
          ))}
          <View style={styles.metaRow}>
            <Ionicons name="wallet-outline" size={16} color={colors.greenDark} />
            <Text style={styles.metaLabel}>{summary.reward.title}</Text>
            <Text style={styles.rewardValue}>{summary.reward.amountText}</Text>
          </View>
        </Card>

        <View style={styles.whatNext}>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
            <Ionicons name="shield-checkmark" size={18} color={colors.greenDark} />
            <View style={{ flex: 1 }}>
              <Text style={styles.whatNextTitle}>What happens next?</Text>
              <Text style={styles.whatNextBody}>
                Our team will review your report. You'll receive a notification once there's an update.
              </Text>
              <Text style={styles.whatNextBold}>Usually reviewed within 24 hours.</Text>
            </View>
          </View>
        </View>

        <View style={{ width: "100%", marginTop: "auto", gap: 10 }}>
          <GreenButton label="View My Reports" onPress={() => router.replace("/user/reports")} />
          <GreenButton label="Back to Home" variant="outline" onPress={() => router.dismissTo("/user/home")} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  successCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.greenLight,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 30,
  },
  title: { fontSize: 24, fontWeight: "800", marginTop: 18 },
  subtitle: { fontSize: 14, color: colors.textSecondary, textAlign: "center", marginTop: 6, lineHeight: 19 },
  rowLabel: { fontSize: 12, color: colors.textSecondary, fontWeight: "600" },
  reportId: { fontSize: 20, fontWeight: "800", marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.borderLight, marginVertical: 12 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  metaLabel: { flex: 1, fontSize: 13.5, color: colors.textSecondary, fontWeight: "600" },
  metaValue: { fontSize: 13.5, fontWeight: "700", maxWidth: 150 },
  rewardValue: { fontSize: 16, fontWeight: "800", color: colors.greenDark },
  whatNext: {
    width: "100%",
    backgroundColor: colors.greenLight,
    borderRadius: radius.card,
    padding: 16,
    marginTop: 14,
  },
  whatNextTitle: { fontWeight: "800", fontSize: 14.5 },
  whatNextBody: { fontSize: 12.5, color: "#0B7A38", marginTop: 4, lineHeight: 17 },
  whatNextBold: { fontSize: 12.5, fontWeight: "800", color: "#0B7A38", marginTop: 6 },
});
