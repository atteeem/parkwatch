import React, { useRef, useState } from "react";
import { View, Text, ScrollView, Image, Pressable, StyleSheet } from "react-native";
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
import { validateDraft } from "../../../src/domain";
import { toDraftReview } from "../../../src/presentation/citizenViews";
import { describeDomainError, draftIssueMessages } from "../../../src/presentation/errors";
import { createSubmitGuard } from "../../../src/presentation/submitGuard";

// CIT-05 Final Review & Submit: PRE-submission only. The submitted-report
// overview (CIT-08) is a separate screen.
export default function ReviewSubmit() {
  const router = useRouter();
  const { draft, submittedReportId, markSubmitted } = useReportDraft();
  const { submitReport, citizenProfile } = useApp();
  const guard = useRef(createSubmitGuard());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const view = toDraftReview(draft, citizenProfile);

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
    setSubmitting(true);
    guard.current.run(() => submitReport(draft), {
      onSuccess: ({ reportId }) => {
        markSubmitted(reportId);
        goToSubmitted(reportId);
      },
      onError: (e) => {
        setSubmitting(false); // stay on Review with the draft intact; user can retry
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
              <Text style={styles.smallMuted}>{view.verifiedReports} verified reports</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardLabel}>Location</Text>
              <Text style={styles.cardValue}>{view.address || "—"}</Text>
              {view.coordinatesText ? <Text style={styles.smallMuted}>{view.coordinatesText}</Text> : null}
              <View style={styles.mapThumb}>
                <View style={styles.mapDot} />
              </View>
              <Pressable onPress={() => router.push("/user/map")} style={{ marginTop: 6 }}>
                <Text style={styles.link}>View on Map</Text>
              </Pressable>
            </View>
          </View>
        </Card>

        <Card>
          <Text style={styles.cardLabel}>Vehicle</Text>
          <View style={{ flexDirection: "row", marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.plate}>{view.vehicle.plate || "—"}</Text>
              {view.vehicle.model ? <Text style={styles.smallMuted}>{view.vehicle.model}</Text> : null}
              {view.vehicle.color ? <Text style={styles.smallMuted}>{view.vehicle.color}</Text> : null}
            </View>
            {view.requiredPhotos[0] && <Image source={{ uri: view.requiredPhotos[0] }} style={styles.vehicleImg} />}
          </View>
        </Card>

        <Card>
          <Text style={styles.cardLabel}>Violation</Text>
          <Text style={styles.cardValue}>{view.violationLabel}</Text>
          {view.violationNote ? <Text style={styles.smallMuted}>{view.violationNote}</Text> : null}
        </Card>

        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={styles.cardLabel}>Evidence</Text>
            <Text style={styles.smallMuted}>
              {view.requiredPhotos.length} photos{view.photosTakenAt ? ` • taken at ${view.photosTakenAt}` : ""}
            </Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            {view.requiredPhotos.map((uri, i) => (
              <Image key={i} source={{ uri }} style={styles.evidenceThumb} />
            ))}
            {view.attachments.length > 0 && (
              <View style={[styles.evidenceThumb, styles.moreThumb]}>
                <Text style={styles.moreLabel}>+{view.attachments.length}</Text>
              </View>
            )}
          </View>
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
        <GreenButton
          label={submitting ? "Submitting…" : "Submit Report"}
          loading={submitting}
          disabled={submitting}
          onPress={handleSubmit}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  cardLabel: { fontSize: 12, fontWeight: "700", color: colors.textSecondary },
  cardValue: { fontSize: 16, fontWeight: "800", marginTop: 3 },
  smallMuted: { fontSize: 11.5, color: colors.textLight, marginTop: 2 },
  trustedBadge: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  trustedText: { fontSize: 11.5, fontWeight: "700", color: colors.greenDark },
  mapThumb: { height: 54, borderRadius: 10, backgroundColor: "#EAF0EC", marginTop: 8, alignItems: "center", justifyContent: "center" },
  mapDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.blue },
  link: { color: colors.greenDark, fontWeight: "700", fontSize: 12 },
  plate: { fontSize: 15, fontWeight: "700" },
  vehicleImg: { width: 70, height: 70, borderRadius: radius.photo, marginLeft: 10 },
  evidenceThumb: { width: 64, height: 64, borderRadius: 12 },
  moreThumb: { backgroundColor: colors.backgroundSunk, alignItems: "center", justifyContent: "center" },
  moreLabel: { fontWeight: "800", color: colors.textSecondary },
  rewardValue: { fontSize: 24, fontWeight: "800", color: colors.greenDark, marginTop: 4 },
  rewardHint: { fontSize: 12, color: "#0B7A38", marginTop: 10, lineHeight: 16 },
  errorText: { color: "#B3261E", fontSize: 12.5, fontWeight: "600", marginBottom: 8, textAlign: "center" },
  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 20, backgroundColor: colors.background },
});
