import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../../src/constants/colors";
import { radius } from "../../../src/constants/spacing";
import { BackHeader } from "../../../src/components/Header";
import { GreenButton } from "../../../src/components/GreenButton";
import { Card } from "../../../src/components/Card";
import { StatusChip } from "../../../src/components/StatusChip";
import { EmptyState } from "../../../src/components/EmptyState";
import { useApp, useReportDetailLoad } from "../../../src/context/AppContext";
import { InlineLoading } from "../../../src/components/CoreDataGate";
import { EvidenceThumbnails } from "../../../src/components/EvidenceGallery";
import { LiveMap } from "../../../src/components/map/LiveMap";
import { TimelineStep } from "../../../src/presentation/citizenReportDetail";

const PANEL_TONE: Record<string, { bg: string; fg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  UNDER_REVIEW: { bg: colors.amberLight, fg: "#8A6300", icon: "time" },
  VERIFIED: { bg: colors.greenLight, fg: colors.greenDark, icon: "checkmark-circle" },
  REJECTED: { bg: colors.redLight, fg: "#B3261E", icon: "close-circle" },
};

const STEP_COLOR: Record<TimelineStep["tone"], string> = {
  neutral: colors.greenDark,
  pending: "#B47A00",
  success: colors.greenDark,
  error: "#B3261E",
};

// The citizen's permanent record of one submitted report (T8.8). Citizen
// statuses and recorded times only: no officer case states, no invented
// outcome. Reward strictly from the ledger. Read-only; safe as a deep link.
export default function ReportDetails() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getCitizenReportDetail, getCitizenReport, ensureReport } = useApp();
  const detail = getCitizenReportDetail(id);
  const highPriority = getCitizenReport(id)?.highPriority;
  // Server mode: fetch this report (deep links, notifications, reports beyond the loaded pages).
  const { loading } = useReportDetailLoad(id);
  const backToMyReports = () => router.dismissTo("/user/reports");

  if (!detail && loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <BackHeader title="Report Details" onBack={backToMyReports} />
        <InlineLoading label="Loading report…" />
      </SafeAreaView>
    );
  }

  if (!detail) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <BackHeader title="Report Details" onBack={backToMyReports} />
        <EmptyState
          icon="document-text-outline"
          title="Report not available"
          body="This report could not be loaded. It may not exist, or it belongs to another account."
          cta={id ? { label: "Try again", onPress: () => ensureReport(id) } : undefined}
        />
        <View style={{ paddingHorizontal: 20 }}>
          <GreenButton label="Back to My Reports" variant="outline" onPress={backToMyReports} />
        </View>
      </SafeAreaView>
    );
  }

  const panel = PANEL_TONE[detail.status];
  const r = detail.reward;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <BackHeader title="Report Details" onBack={backToMyReports} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 130, gap: 14 }}>
        <View style={[styles.statusPanel, { backgroundColor: panel.bg }]} accessible accessibilityLabel={`Report ${detail.id}, ${detail.statusLabel}`}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name={panel.icon} size={16} color={panel.fg} />
            <Text style={[styles.statusPanelTitle, { color: panel.fg }]}>{detail.statusLabel}</Text>
          </View>
          <Text style={[styles.statusPanelSub, { color: panel.fg }]}>Submitted on {detail.submittedAtText}</Text>
          <Text style={[styles.statusPanelId, { color: panel.fg }]}>#{detail.id}</Text>
        </View>

        {/* Reward strictly from the ledger. */}
        <Card style={r.kind === "none" ? { backgroundColor: colors.backgroundSunk, borderColor: colors.borderLight } : { backgroundColor: colors.greenLight, borderColor: "#BFEBCF" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Ionicons name={r.kind === "earned" ? "gift" : r.kind === "pending" ? "hourglass-outline" : "remove-circle-outline"} size={22} color={r.kind === "none" ? colors.textSecondary : colors.greenDark} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rewardTitle, r.kind === "none" && { color: colors.textSecondary }]}>{r.title}</Text>
              <Text style={styles.smallMuted}>{r.detail}</Text>
            </View>
          </View>
          {r.walletLink ? (
            <GreenButton label="View in Wallet" small variant="outline" onPress={() => router.push("/user/earnings")} style={{ marginTop: 12 }} />
          ) : null}
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Timeline</Text>
          <View style={{ marginTop: 10 }}>
            {detail.timeline.map((s, i) => {
              const last = i === detail.timeline.length - 1;
              const color = STEP_COLOR[s.tone];
              return (
                <View key={s.key} style={styles.stepRow} accessible accessibilityLabel={[s.label, s.timeText, s.detail].filter(Boolean).join(", ")}>
                  <View style={styles.stepRail}>
                    <View style={[styles.stepDot, { borderColor: color, backgroundColor: s.state === "current" ? color : colors.white }]} />
                    {!last ? <View style={styles.stepLine} /> : null}
                  </View>
                  <View style={{ flex: 1, paddingBottom: last ? 0 : 14 }}>
                    <Text style={[styles.stepLabel, s.state === "current" && { color }]}>{s.label}</Text>
                    {s.timeText ? <Text style={styles.stepTime}>{s.timeText}</Text> : null}
                    {s.detail ? <Text style={styles.smallMuted}>{s.detail}</Text> : null}
                  </View>
                </View>
              );
            })}
          </View>
        </Card>

        <Card>
          <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardLabel}>Violation</Text>
              <Text style={styles.cardValue}>{detail.violationLabel}</Text>
            </View>
            {highPriority ? <StatusChip label="High Priority" tone="red" /> : null}
          </View>
          <Text style={[styles.cardLabel, { marginTop: 12 }]}>Observed</Text>
          <Text style={styles.fieldValue}>{detail.observedAtText}</Text>
          {detail.reporterNotes ? (
            <>
              <Text style={[styles.cardLabel, { marginTop: 12 }]}>Your notes</Text>
              <Text style={styles.fieldValue}>{detail.reporterNotes}</Text>
            </>
          ) : null}
        </Card>

        <Card>
          <Text style={styles.cardLabel}>Location</Text>
          <Text style={styles.cardValue} numberOfLines={3}>
            {detail.address}
          </Text>
          {detail.point ? (
            <>
              <LiveMap style={styles.map} interactive={false} markers={[]} reportPoint={detail.point} focusPoint={detail.point} following={false} />
              <Text style={styles.smallMuted}>{detail.pointSourceText}</Text>
            </>
          ) : (
            <Text style={styles.smallMuted}>No map point was recorded for this report (address only).</Text>
          )}
        </Card>

        <Card>
          <Text style={styles.cardLabel}>Vehicle</Text>
          {detail.vehicle.plate ? <Text style={styles.plate}>{detail.vehicle.plate}</Text> : <Text style={styles.fieldValue}>Plate not recorded</Text>}
          {detail.vehicle.model || detail.vehicle.color ? (
            <Text style={styles.smallMuted}>{[detail.vehicle.model, detail.vehicle.color].filter(Boolean).join(" · ")}</Text>
          ) : null}
        </Card>

        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={styles.cardLabel}>Evidence</Text>
            <Text style={styles.smallMuted}>
              {detail.requiredPhotoCount} photos{detail.attachmentCount > 0 ? ` · ${detail.attachmentCount} attachment${detail.attachmentCount === 1 ? "" : "s"}` : ""}
            </Text>
          </View>
          {detail.evidence.length > 0 ? (
            // Tap any photo: full screen, swipe through Front / Side / Rear / attachments.
            <EvidenceThumbnails items={detail.evidence} thumbStyle={styles.evidenceThumb} max={4} style={{ gap: 8, marginTop: 10 }} />
          ) : (
            <Text style={[styles.smallMuted, { marginTop: 8 }]}>The photos for this report are not available right now.</Text>
          )}
        </Card>
      </ScrollView>
      <View style={styles.bottomBar}>
        <GreenButton label="Back to My Reports" variant="outline" onPress={backToMyReports} />
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
  sectionTitle: { fontSize: 15, fontWeight: "800", color: colors.textPrimary },
  cardLabel: { fontSize: 12, fontWeight: "700", color: colors.textSecondary },
  cardValue: { fontSize: 16, fontWeight: "800", marginTop: 3 },
  fieldValue: { fontSize: 14, fontWeight: "600", marginTop: 2, color: colors.textPrimary },
  smallMuted: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  plate: { fontSize: 17, fontWeight: "800", marginTop: 3 },
  map: { height: 140, borderRadius: 12, marginTop: 10, marginBottom: 4 },
  evidenceThumb: { width: "100%", aspectRatio: 1, borderRadius: 10 },
  rewardTitle: { fontSize: 16, fontWeight: "800", color: colors.greenDark },
  stepRow: { flexDirection: "row" },
  stepRail: { width: 22, alignItems: "center" },
  stepDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, marginTop: 3 },
  stepLine: { flex: 1, width: 2, backgroundColor: colors.borderLight, marginTop: 2 },
  stepLabel: { fontSize: 14, fontWeight: "800", color: colors.textPrimary },
  stepTime: { fontSize: 12.5, fontWeight: "600", color: colors.textPrimary, marginTop: 1 },
  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 20, backgroundColor: colors.background },
});
