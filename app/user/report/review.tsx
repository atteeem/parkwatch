import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../../src/constants/colors";
import { radius } from "../../../src/constants/spacing";
import { BackHeader } from "../../../src/components/Header";
import { ReportStepper } from "../../../src/components/ReportStepper";
import { GreenButton } from "../../../src/components/GreenButton";
import { Card } from "../../../src/components/Card";
import { StatusChip } from "../../../src/components/StatusChip";
import { useReportDraft } from "../../../src/context/ReportContext";
import { useApp } from "../../../src/context/AppContext";
import { EvidencePhoto } from "../../../src/components/EvidencePhoto";
import { EvidenceThumbnails } from "../../../src/components/EvidenceGallery";
import { LiveMap } from "../../../src/components/map/LiveMap";
import { REVIEW_EDIT_ROUTE, ReviewEditTarget } from "../../../src/presentation/reportDraft";
import { validateDraft } from "../../../src/domain";
import { toDraftReview } from "../../../src/presentation/citizenViews";
import { describeDomainError, draftIssueMessages } from "../../../src/presentation/errors";
import { useGuardedAction } from "../../../src/presentation/useGuardedAction";

// CIT-05 Final Review & Submit: PRE-submission only. The submitted-report
// overview (CIT-08) is a separate screen.
export default function ReviewSubmit() {
  const router = useRouter();
  const { draft, submittedReportId, markSubmitted, uploadedPaths, recordUpload, resetUploads } = useReportDraft();
  const { submitReport, citizenProfile, dataSource } = useApp();
  const guard = useGuardedAction();
  // "uploading"/"submitting" only appear for the server; the local store answers at once.
  const [phase, setPhase] = useState<"idle" | "uploading" | "submitting" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);
  const submitting = phase === "uploading" || phase === "submitting";

  const view = toDraftReview(draft, citizenProfile);
  // Edit a step, then come straight back here (the step sees from=review).
  const edit = (target: ReviewEditTarget) => {
    if (submitting || submittedReportId) return;
    router.push({ pathname: REVIEW_EDIT_ROUTE[target], params: { from: "review" } });
  };

  const goToSubmitted = (reportId: string) => {
    // Remove the finished wizard from the stack: Home -> Report Submitted.
    router.dismissTo("/user/home");
    router.push({ pathname: "/user/report/submitted", params: { id: reportId } });
  };

  const handleSubmit = () => {
    if (submittedReportId) {
      goToSubmitted(submittedReportId); // finished draft: never submit again
      return;
    }
    const issues = validateDraft(draft, "SUBMIT");
    if (issues.length > 0) {
      setError(Object.values(draftIssueMessages(issues))[0] ?? null);
      return;
    }
    setError(null);
    setPhase("submitting");
    // Same draft id on every retry: the server returns the same report instead of a duplicate.
    // Finished uploads (also from before an app restart) are skipped; the server
    // recognises the same draft id and never creates a second report.
    guard.run(() => submitReport(draft, { onProgress: setPhase, uploaded: uploadedPaths, onUploaded: recordUpload, onUploadsInvalid: resetUploads }), {
      onSuccess: ({ reportId }) => {
        setPhase("idle");
        markSubmitted(reportId);
        goToSubmitted(reportId);
      },
      onError: (e) => {
        setPhase("failed"); // stay on Review with the draft intact; user can retry
        setError(describeDomainError(e).message);
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <BackHeader title="Report overview" onBack={() => router.back()} />
      <ReportStepper activeStep={4} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 160, gap: 14 }}>
        <Card>
          <View style={{ flexDirection: "row", gap: 14 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardLabel}>Reporter</Text>
              <Text style={styles.cardValue}>{view.reporterName}</Text>
              {view.trustedReporter && (
                <View style={styles.trustedBadge}>
                  <Ionicons name="shield-checkmark" size={12} color={colors.greenDark} />
                  <Text style={styles.trustedText}>Trusted Reporter</Text>
                </View>
              )}
              {view.reporterStatsKnown && <Text style={styles.smallMuted}>{view.verifiedReports} verified reports</Text>}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardLabel}>Observed</Text>
              <Text style={styles.cardValueSmall}>{view.observedText ?? "—"}</Text>
              <Text style={styles.smallMuted}>From your first photo</Text>
            </View>
          </View>
        </Card>

        <Card>
          <SectionHeader title="Location" action="Edit" onPress={() => edit("details")} />
          <Text style={styles.cardValue}>{view.address || "—"}</Text>
          {view.pointSourceText ? (
            <Text style={styles.smallMuted}>
              {view.pointSourceText}
              {view.coordinatesText ? ` · ${view.coordinatesText}` : ""}
            </Text>
          ) : (
            <Text style={styles.smallMuted}>Address only (no map point)</Text>
          )}
          {view.point ? (
            <LiveMap style={styles.mapPreview} interactive={false} markers={[]} reportPoint={view.point} focusPoint={view.point} following={false} />
          ) : null}
        </Card>

        <Card>
          <Text style={styles.cardLabel}>Vehicle</Text>
          <View style={{ flexDirection: "row", marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.plate}>{view.vehicle.plate || "—"}</Text>
              {view.vehicle.model ? <Text style={styles.smallMuted}>{view.vehicle.model}</Text> : null}
              {view.vehicle.color ? <Text style={styles.smallMuted}>{view.vehicle.color}</Text> : null}
            </View>
            {view.requiredPhotos[0] && <EvidencePhoto uri={view.requiredPhotos[0]} style={styles.vehicleImg} />}
          </View>
        </Card>

        <Card>
          <SectionHeader title="Violation" action="Change" onPress={() => edit("violation")} />
          <Text style={styles.cardValue}>{view.violationLabel}</Text>
          {view.violationNote ? <Text style={styles.smallMuted}>{view.violationNote}</Text> : null}
        </Card>

        <Card>
          <SectionHeader title="Additional information" action="Edit" onPress={() => edit("details")} />
          <Text style={[styles.notes, !view.notes && styles.smallMuted]}>{view.notes || "None added"}</Text>
        </Card>

        <Card>
          <SectionHeader title="Evidence" action="Edit photos" onPress={() => edit("photos")} />
          <Text style={styles.smallMuted}>
            {view.requiredPhotos.length} photos{view.photosTakenAt ? ` • taken at ${view.photosTakenAt}` : ""} · tap a photo to view it full screen
          </Text>
          <EvidenceThumbnails items={view.gallery} thumbStyle={styles.evidenceThumb} max={4} style={{ marginTop: 10 }} />
          {view.attachments.length > 0 && (
            <Text style={[styles.smallMuted, { marginTop: 8 }]}>
              {view.attachments.length} optional {view.attachments.length === 1 ? "attachment" : "attachments"}
            </Text>
          )}
        </Card>

        <Card style={{ backgroundColor: colors.greenLight, borderColor: "#BFEBCF" }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View>
              <Text style={styles.cardLabel}>Estimated Reward</Text>
              <Text style={styles.rewardValue}>{view.estimatedRewardText}</Text>
            </View>
            <StatusChip label="Pending" tone="green" />
          </View>
          <Text style={styles.rewardHint}>The reward will be added to your balance after the report is verified</Text>
        </Card>
      </ScrollView>
      <View style={styles.bottomBar}>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {error && dataSource === "BACKEND" ? <Text style={styles.savedHint}>Your report is saved on this phone until it has been sent.</Text> : null}
        <GreenButton
          label={phase === "uploading" ? "Uploading photos…" : phase === "submitting" ? "Submitting…" : phase === "failed" ? "Try Again" : "Submit Report"}
          loading={submitting || guard.busy}
          disabled={submitting || guard.busy}
          onPress={handleSubmit}
        />
      </View>
    </SafeAreaView>
  );
}

/** Card title with a small edit action on the right. */
function SectionHeader({ title, action, onPress }: { title: string; action: string; onPress: () => void }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <Text style={styles.cardLabel}>{title}</Text>
      <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={`${action}: ${title}`}>
        <Text style={styles.link}>{action}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  cardLabel: { fontSize: 12, fontWeight: "700", color: colors.textSecondary },
  cardValue: { fontSize: 16, fontWeight: "800", marginTop: 3 },
  smallMuted: { fontSize: 11.5, color: colors.textLight, marginTop: 2 },
  trustedBadge: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  trustedText: { fontSize: 11.5, fontWeight: "700", color: colors.greenDark },
  cardValueSmall: { fontSize: 14, fontWeight: "800", marginTop: 3 },
  mapPreview: { height: 140, borderRadius: radius.card, marginTop: 10 },
  notes: { fontSize: 14, color: colors.textPrimary, marginTop: 6, lineHeight: 20 },
  link: { color: colors.greenDark, fontWeight: "800", fontSize: 12.5 },
  plate: { fontSize: 15, fontWeight: "700" },
  vehicleImg: { width: 70, height: 70, borderRadius: radius.photo, marginLeft: 10 },
  evidenceThumb: { width: "100%", aspectRatio: 1, borderRadius: 12 },
  rewardValue: { fontSize: 24, fontWeight: "800", color: colors.greenDark, marginTop: 4 },
  rewardHint: { fontSize: 12, color: "#0B7A38", marginTop: 10, lineHeight: 16 },
  savedHint: { color: colors.textSecondary, fontSize: 12, marginBottom: 8, textAlign: "center" },
  errorText: { color: "#B3261E", fontSize: 12.5, fontWeight: "600", marginBottom: 8, textAlign: "center" },
  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 20, backgroundColor: colors.background },
});
