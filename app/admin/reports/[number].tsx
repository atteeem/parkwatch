import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
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
  REWARD_ENTRY_LABEL,
  REWARD_STATE_LABEL,
  violationLabel,
} from "../../../src/admin/adminViews";
import { EvidenceThumbnails } from "../../../src/components/EvidenceGallery";
import { LiveMap } from "../../../src/components/map/LiveMap";
import type { AdminReportDetail } from "../../../src/admin/adminTypes";

export default function AdminReportDetailScreen() {
  const router = useRouter();
  const { number } = useLocalSearchParams<{ number: string }>();
  const { admin } = useApp();
  const n = Number(number);
  const load = useAdminLoad(() => admin!.getReport(n), `report-${number}`);
  const back = { label: "Reports", onPress: () => (router.canGoBack() ? router.back() : router.replace("/admin/reports")) };

  return (
    <AdminPage title={`Report #${Number.isFinite(n) ? n : "?"}`} back={back} onRefresh={load.reload}>
      {load.phase === "loading" ? (
        <LoadingState />
      ) : load.phase === "failed" ? (
        <FailureState failure={load.failure} onRetry={load.reload} />
      ) : !load.data ? (
        <NotFoundState what="Report" onBack={back.onPress} />
      ) : (
        <ReportBody d={load.data} openCase={(id) => router.push(`/admin/cases/${id}` as never)} />
      )}
    </AdminPage>
  );
}

function ReportBody({ d, openCase }: { d: AdminReportDetail; openCase: (id: string) => void }) {
  return (
    <>
      <View style={styles.tags}>
        <Pill text={`Citizen status: ${REPORT_STATUS_LABEL[d.status]}`} tone={d.status === "VERIFIED" ? "green" : d.status === "REJECTED" ? "red" : "amber"} />
        <Pill text={`Priority: ${PRIORITY_LABEL[d.priority]}`} tone={d.priority === "HIGH" ? "red" : "neutral"} />
        <Pill text={`Reward: ${REWARD_STATE_LABEL[d.rewardState]}`} tone={d.rewardState === "AVAILABLE" ? "green" : d.rewardState === "VOIDED" ? "neutral" : "amber"} />
      </View>

      <View style={styles.columns}>
        <Section title="Report" style={styles.col}>
          <KeyValue k="Violation" v={violationLabel(d.violationType)} />
          <KeyValue k="Plate" v={d.plate ?? "—"} />
          {d.vehicle ? <KeyValue k="Vehicle" v={d.vehicle} /> : null}
          <KeyValue k="Reporter" v={`${d.citizenRef} (pseudonymous)`} />
          <KeyValue k="Observed (device)" v={formatStamp(d.observedAt)} />
          <KeyValue k="Submitted (device)" v={formatStamp(d.submittedAt)} />
          <KeyValue k="Received (server)" v={formatStamp(d.receivedAt)} />
          <KeyValue k="Notes" v={d.notes || "—"} />
        </Section>

        <Section title="Location" style={styles.col}>
          <KeyValue k="Address" v={d.locationAddress || "—"} />
          <KeyValue
            k="Point"
            v={
              d.point
                ? `${d.point.latitude.toFixed(5)}, ${d.point.longitude.toFixed(5)} · ${d.locationSource === "MAP_SELECTED" ? "set by reporter on the map" : `GPS${d.accuracyMeters !== undefined ? ` (±${Math.round(d.accuracyMeters)} m)` : ""}`}`
                : "Address only"
            }
          />
          {d.point ? <LiveMap style={styles.map} interactive={false} markers={[]} reportPoint={d.point} focusPoint={d.point} following={false} /> : null}
        </Section>
      </View>

      <Section title={`Citizen evidence (${d.evidence.length})`}>
        {d.evidence.length ? (
          <EvidenceThumbnails items={d.evidence} thumbStyle={styles.thumb} max={6} />
        ) : (
          <Text style={adminStyles.muted}>No photos.</Text>
        )}
        <Text style={[adminStyles.muted, { marginTop: 8 }]}>Tap a photo to view all photos full screen.</Text>
      </Section>

      <Section title="Officer case">
        {d.caseInfo ? (
          <>
            <KeyValue k="Status" v={CASE_STATUS_LABEL[d.caseInfo.status]} />
            <KeyValue k="Assigned officer" v={d.caseInfo.assignedOfficerName ?? (d.caseInfo.status === "NEW" ? "Unassigned" : "—")} />
            <KeyValue k="Created" v={formatStamp(d.caseInfo.createdAt)} />
            {d.caseInfo.completedAt ? <KeyValue k="Completed" v={formatStamp(d.caseInfo.completedAt)} /> : null}
            {d.outcome ? (
              <>
                <KeyValue k="Outcome" v={outcomeText(d.outcome.code)} />
                <KeyValue k="Decided" v={`${formatStamp(d.outcome.decidedAt)}${d.outcome.decidedByName ? ` by ${d.outcome.decidedByName}` : ""}`} />
                {d.outcome.code === "CHARGE_ISSUED" && d.outcome.parkingChargeCents !== undefined ? (
                  <KeyValue k="Parking charge" v={formatEuros(d.outcome.parkingChargeCents)} />
                ) : null}
              </>
            ) : null}
            <Text style={styles.link} onPress={() => openCase(d.caseInfo!.id)} accessibilityRole="link">
              Open case
            </Text>
          </>
        ) : (
          <Text style={adminStyles.muted}>No case linked to this report.</Text>
        )}
      </Section>

      <Section title="Citizen reward">
        <KeyValue k="State" v={REWARD_STATE_LABEL[d.rewardState]} />
        {d.ledger.length ? (
          d.ledger.map((l) => <KeyValue key={l.id} k={formatStamp(l.createdAt)} v={`${REWARD_ENTRY_LABEL[l.entryType] ?? l.entryType} · ${formatEuros(l.amountCents)}`} />)
        ) : (
          <Text style={adminStyles.muted}>No ledger entries.</Text>
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
  map: { height: 200, borderRadius: radius.card, marginTop: 8 },
  thumb: { width: "100%", aspectRatio: 1, borderRadius: 8 },
  link: { marginTop: 10, color: "#0B7A38", fontWeight: "800" },
});
