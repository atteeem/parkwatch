import React from "react";
import { View, Text, ScrollView, Image, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../../src/constants/colors";
import { radius } from "../../../src/constants/spacing";
import { BackHeader } from "../../../src/components/Header";
import { GreenButton } from "../../../src/components/GreenButton";
import { Card } from "../../../src/components/Card";
import { StatusChip } from "../../../src/components/StatusChip";
import { useApp } from "../../../src/context/AppContext";
import { violationLabel } from "../../../src/data/types";

const PANEL_TONE: Record<string, { bg: string; fg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  "under-review": { bg: colors.amberLight, fg: "#8A6300", icon: "time" },
  verified: { bg: colors.greenLight, fg: colors.greenDark, icon: "checkmark-circle" },
  rejected: { bg: colors.redLight, fg: "#B3261E", icon: "close-circle" },
};

export default function ReportOverview() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userReports } = useApp();
  const report = userReports.find((r) => r.id === id);

  if (!report) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <BackHeader title="Report overview" onBack={() => router.back()} />
        <Text style={{ padding: 20, color: colors.textSecondary }}>Report not found.</Text>
      </SafeAreaView>
    );
  }

  const panel = PANEL_TONE[report.status];
  const submittedLabel = new Date(report.submittedAt).toLocaleString([], {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <BackHeader title="Report overview" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 130, gap: 14 }}>
        <View style={[styles.statusPanel, { backgroundColor: panel.bg }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name={panel.icon} size={16} color={panel.fg} />
            <Text style={[styles.statusPanelTitle, { color: panel.fg }]}>
              {report.status === "under-review" ? "Under Review" : report.status === "verified" ? "Verified" : "Rejected"}
            </Text>
          </View>
          <Text style={[styles.statusPanelSub, { color: panel.fg }]}>Submitted on {submittedLabel}</Text>
          <Text style={[styles.statusPanelId, { color: panel.fg }]}>#{report.id}</Text>
        </View>

        <Card>
          <View style={{ flexDirection: "row", gap: 14 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardLabel}>Reporter</Text>
              <Text style={styles.cardValue}>You</Text>
              <Text style={styles.smallMuted}>Trusted Reporter</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardLabel}>Location</Text>
              <Text style={styles.cardValue} numberOfLines={2}>
                {report.location}
              </Text>
            </View>
          </View>
        </Card>

        <Card>
          <View style={{ flexDirection: "row" }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardLabel}>Vehicle</Text>
              <Text style={styles.plate}>{report.plate}</Text>
              <Text style={styles.smallMuted}>{report.vehicle ?? "Vehicle"}</Text>
              <Text style={styles.smallMuted}>{report.vehicleColor}</Text>
            </View>
            {report.images[0] && <Image source={{ uri: report.images[0] }} style={styles.vehicleImg} />}
          </View>
        </Card>

        <Card>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardLabel}>Violation</Text>
              <Text style={styles.cardValue}>{violationLabel(report.violation)}</Text>
              <Text style={styles.smallMuted}>{report.violationNote}</Text>
            </View>
            {report.highPriority && <StatusChip label="High Priority" tone="red" />}
          </View>
        </Card>

        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={styles.cardLabel}>Evidence</Text>
            <Text style={styles.smallMuted}>{report.images.length} photos</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            {report.images.slice(0, 4).map((uri, i) => (
              <Image key={i} source={{ uri }} style={styles.evidenceThumb} />
            ))}
          </View>
        </Card>

        <Card style={{ backgroundColor: colors.greenLight, borderColor: "#BFEBCF" }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View>
              <Text style={styles.cardLabel}>Estimated reward</Text>
              <Text style={styles.rewardValue}>{"\u20ac"}{(report.reward ?? 5).toFixed(2)}</Text>
            </View>
            <StatusChip label={report.rewardState === "rewarded" ? "Rewarded" : "Pending"} tone="green" />
          </View>
        </Card>
      </ScrollView>
      <View style={styles.bottomBar}>
        <GreenButton label="Back to My Reports" variant="outline" onPress={() => router.replace("/user/reports")} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  statusPanel: { borderRadius: radius.card, padding: 16 },
  statusPanelTitle: { fontWeight: "800", fontSize: 15 },
  statusPanelSub: { fontSize: 12.5, marginTop: 6, fontWeight: "600" },
  statusPanelId: { position: "absolute", right: 16, top: 16, fontWeight: "800", fontSize: 13 },
  cardLabel: { fontSize: 12, fontWeight: "700", color: colors.textSecondary },
  cardValue: { fontSize: 16, fontWeight: "800", marginTop: 3 },
  smallMuted: { fontSize: 11.5, color: colors.textLight, marginTop: 2 },
  plate: { fontSize: 17, fontWeight: "800", marginTop: 3 },
  vehicleImg: { width: 74, height: 74, borderRadius: radius.photo, marginLeft: 10 },
  evidenceThumb: { width: 60, height: 60, borderRadius: 12 },
  rewardValue: { fontSize: 22, fontWeight: "800", color: colors.greenDark, marginTop: 3 },
  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 20, backgroundColor: colors.background },
});
