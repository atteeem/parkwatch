import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../../src/constants/colors";
import { radius } from "../../../src/constants/spacing";
import { useApp } from "../../../src/context/AppContext";
import { AdminPage } from "../../../src/admin/AdminShell";
import { adminStyles, AuditList, FailureState, KeyValue, LoadingState, NotFoundState, Pill, Section, useAdminLoad } from "../../../src/admin/AdminUI";
import {
  CASE_STATUS_LABEL,
  formatEuros,
  formatStamp,
  outcomeText,
  PRIORITY_LABEL,
  REPORT_STATUS_LABEL,
  REWARD_STATE_LABEL,
  violationLabel,
} from "../../../src/admin/adminViews";
import { EvidenceThumbnails } from "../../../src/components/EvidenceGallery";
import { LiveMap } from "../../../src/components/map/LiveMap";
import type { AdminCaseDetail } from "../../../src/admin/adminTypes";

const CHECK_LABEL: Record<string, string> = {
  vehiclePresent: "Vehicle present",
  plateMatches: "License plate matches",
  violationConfirmed: "Violation confirmed",
  restrictionVerified: "Parking restriction verified",
};

export default function AdminCaseDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { admin } = useApp();
  const load = useAdminLoad(() => admin!.getCase(String(id ?? "")), `case-${id}`);
  const back = { label: "Cases", onPress: () => (router.canGoBack() ? router.back() : router.replace("/admin/cases")) };
  const title = load.phase === "ready" && load.data ? `Case · Report #${load.data.report.publicNumber}` : "Case";

  return (
    <AdminPage title={title} back={back} onRefresh={load.reload}>
      {load.phase === "loading" ? (
        <LoadingState />
      ) : load.phase === "failed" ? (
        <FailureState failure={load.failure} onRetry={load.reload} />
      ) : !load.data ? (
        <NotFoundState what="Case" onBack={back.onPress} />
      ) : (
        <CaseBody d={load.data} openReport={(n) => router.push(`/admin/reports/${n}` as never)} />
      )}
    </AdminPage>
  );
}

function CaseBody({ d, openReport }: { d: AdminCaseDetail; openReport: (n: number) => void }) {
  const t = d.timeline;
  return (
    <>
      <View style={styles.tags}>
        <Pill text={`Case: ${CASE_STATUS_LABEL[d.status]}`} tone={d.status === "COMPLETED" ? "neutral" : "blue"} />
        <Pill text={`Priority: ${PRIORITY_LABEL[d.priority]}`} tone={d.priority === "HIGH" ? "red" : "neutral"} />
        <Pill text={`Citizen status: ${REPORT_STATUS_LABEL[d.report.status]}`} tone={d.report.status === "VERIFIED" ? "green" : d.report.status === "REJECTED" ? "red" : "amber"} />
        <Pill text={`Reward: ${REWARD_STATE_LABEL[d.rewardState]}`} />
      </View>

      <View style={styles.columns}>
        <Section title="Case" style={styles.col}>
          <KeyValue k="Case id" v={d.id} />
          <KeyValue k="Assigned officer" v={d.assignedOfficerName ?? (d.status === "NEW" ? "Unassigned" : "—")} />
          <KeyValue k="Created" v={formatStamp(t.createdAt)} />
          <KeyValue k="Assigned" v={formatStamp(t.assignedAt)} />
          <KeyValue k="En route" v={formatStamp(t.enRouteAt)} />
          <KeyValue k="On site" v={formatStamp(t.onSiteAt)} />
          <KeyValue k="Inspection started" v={formatStamp(t.inspectionStartedAt)} />
          <KeyValue k="Completed" v={formatStamp(t.completedAt)} />
        </Section>

        <Section title="Report" style={styles.col}>
          <KeyValue k="Report" v={`#${d.report.publicNumber}`} />
          <KeyValue k="Violation" v={violationLabel(d.report.violationType)} />
          <KeyValue k="Plate" v={d.report.plate ?? "—"} />
          {d.report.vehicle ? <KeyValue k="Vehicle" v={d.report.vehicle} /> : null}
          <KeyValue k="Reporter" v={`${d.report.citizenRef} (pseudonymous)`} />
          <KeyValue k="Observed (device)" v={formatStamp(d.report.observedAt)} />
          <KeyValue k="Received (server)" v={formatStamp(d.report.receivedAt)} />
          <KeyValue k="Address" v={d.report.locationAddress || "—"} />
          <KeyValue k="Point" v={d.report.point ? (d.report.locationSource === "MAP_SELECTED" ? "Set by reporter on the map" : "Reporter GPS") : "Address only"} />
          <KeyValue k="Citizen notes" v={d.report.notes || "—"} />
          <Text style={styles.link} onPress={() => openReport(d.report.publicNumber)} accessibilityRole="link">
            Open report
          </Text>
        </Section>
      </View>

      {d.report.point ? (
        <Section title="Map">
          <LiveMap style={styles.map} interactive={false} markers={[]} reportPoint={d.report.point} focusPoint={d.report.point} following={false} />
        </Section>
      ) : null}

      <View style={styles.columns}>
        <Section title={`Citizen evidence (${d.citizenEvidence.length})`} style={styles.col}>
          {d.citizenEvidence.length ? <EvidenceThumbnails items={d.citizenEvidence} thumbStyle={styles.thumb} max={4} /> : <Text style={adminStyles.muted}>No photos.</Text>}
        </Section>
        <Section title={`Officer evidence (${d.officerEvidence.length} of 4)`} style={styles.col}>
          {d.officerEvidence.length ? <EvidenceThumbnails items={d.officerEvidence} thumbStyle={styles.thumb} max={4} /> : <Text style={adminStyles.muted}>No officer photos yet.</Text>}
        </Section>
      </View>

      <Section title="Inspection">
        {d.inspection ? (
          <>
            <KeyValue k="Started" v={formatStamp(d.inspection.startedAt)} />
            {d.inspection.plateConfirmedAt ? <KeyValue k="Plate confirmed" v={`${formatStamp(d.inspection.plateConfirmedAt)} (simulated scan control)`} /> : null}
            {d.inspection.checks.map((c) => (
              <View key={c.key} style={styles.check}>
                <Ionicons
                  name={c.answer === true ? "checkmark-circle" : c.answer === false ? "close-circle" : "ellipse-outline"}
                  size={17}
                  color={c.answer === true ? colors.greenDark : c.answer === false ? "#B3261E" : colors.textLight}
                />
                <Text style={adminStyles.cell}>{CHECK_LABEL[c.key] ?? c.key}</Text>
                <Text style={adminStyles.muted}>{c.answer === true ? "Confirmed" : c.answer === false ? "Not confirmed" : "Not answered"}</Text>
              </View>
            ))}
            <KeyValue k="Officer notes" v={d.inspection.notes || "—"} />
          </>
        ) : (
          <Text style={adminStyles.muted}>The inspection has not started.</Text>
        )}
      </Section>

      <Section title="Enforcement outcome">
        {d.outcome ? (
          <>
            <KeyValue k="Outcome" v={outcomeText(d.outcome.code)} />
            <KeyValue k="Decided" v={`${formatStamp(d.outcome.decidedAt)}${d.outcome.decidedByName ? ` by ${d.outcome.decidedByName}` : ""}`} />
            {d.outcome.code === "CHARGE_ISSUED" && d.outcome.parkingChargeCents !== undefined ? (
              <KeyValue k="Parking charge" v={formatEuros(d.outcome.parkingChargeCents)} />
            ) : null}
            {d.outcome.notes ? <KeyValue k="Outcome notes" v={d.outcome.notes} /> : null}
          </>
        ) : (
          <Text style={adminStyles.muted}>No outcome yet. Only the officer records the outcome.</Text>
        )}
      </Section>

      <Section title="History">
        <AuditList events={d.audit} />
      </Section>
    </>
  );
}

const styles = StyleSheet.create({
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  columns: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  col: { flexGrow: 1, flexBasis: 340 },
  map: { height: 220, borderRadius: radius.card },
  thumb: { width: "100%", aspectRatio: 1, borderRadius: 8 },
  check: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  link: { marginTop: 10, color: "#0B7A38", fontWeight: "800" },
});
