import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { radius } from "../../src/constants/spacing";
import { GreenButton } from "../../src/components/GreenButton";
import { Card } from "../../src/components/Card";
import { BackHeader } from "../../src/components/Header";
import { EmptyState } from "../../src/components/EmptyState";
import { useApp, useCaseDetailLoad, usePagedList } from "../../src/context/AppContext";
import { DetailLoading } from "../../src/components/CoreDataGate";
import { EvidenceGallery, EvidenceThumbnails } from "../../src/components/EvidenceGallery";
import { useForegroundLocation } from "../../src/location/useForegroundLocation";
import { ChecklistAnswer, sortQueue, toCaseRecord, withDistances } from "../../src/presentation/officerViews";
import { SuccessMark } from "../../src/components/motion/SuccessMark";
import { FadeIn } from "../../src/components/motion/FadeIn";
import { openNextCase, resetToOfficerHome } from "../../src/navigation/officerNavigation";

const ANSWER: Record<ChecklistAnswer, { text: string; icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  confirmed: { text: "Confirmed", icon: "checkmark-circle", color: colors.greenDark },
  "not-confirmed": { text: "Not confirmed", icon: "close-circle", color: "#B3261E" },
  "not-answered": { text: "Not answered", icon: "ellipse-outline", color: colors.textLight },
};

// OFF-09 + completed-case record (T8.8). Rendered entirely from the stored
// case: the charge line appears only for CHARGE_ISSUED, the checklist and
// officer photos only if an on-site inspection was recorded.
// * Right after deciding (no `from`): success header + Next Case / Home.
// * Opened later (`from` = record / notifications): a plain record; Back returns.
export default function InspectionCompleted() {
  const router = useRouter();
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const asRecord = !!from;
  // Opened as a record (notification / details) rather than right after deciding: Back returns there.
  const leave = () => (from && router.canGoBack() ? router.back() : resetToOfficerHome(router));
  // Server mode: (re)load this case when the screen opens, so it is current even off the loaded pages.
  const caseLoad = useCaseDetailLoad(id);
  const { getCase, getCaseDetail, getInspection, ensureCase } = useApp();
  const freshQueue = usePagedList({ kind: "queue", filter: "New" });
  const location = useForegroundLocation();
  const [gallery, setGallery] = useState<{ kind: "citizen" | "officer"; index: number } | null>(null);
  const c = getCase(id);
  const record = c ? toCaseRecord(c, getInspection(c.id), getCaseDetail(c.id)) : null;

  if (caseLoad.loading && (!c || !record)) return <DetailLoading />;

  if (!c || !record) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <BackHeader title="Case Record" onBack={leave} />
        <EmptyState
          icon={!c ? "folder-open-outline" : "time-outline"}
          title={!c ? "Case not available" : "Not completed yet"}
          body={!c ? "This case could not be loaded. It may have been removed or is no longer visible to you." : "No outcome has been recorded for this case yet."}
          cta={!c ? (id ? { label: "Try again", onPress: () => ensureCase(id) } : undefined) : { label: "Open case", onPress: () => router.replace({ pathname: "/officer/report-details", params: { id: c.id } }) }}
        />
      </SafeAreaView>
    );
  }

  const handleNextCase = () => {
    const fix = location.permission === "granted" ? location.fix : undefined;
    const next = sortQueue(withDistances(freshQueue.items, fix)).find((x) => x.id !== c.id);
    if (next) openNextCase(router, next.id);
    else {
      resetToOfficerHome(router);
      router.replace("/officer/queue");
    }
  };

  const body = (
    <>
      <Card style={{ width: "100%" }}>
        <View style={styles.headRow}>
          <Text style={styles.reportId}>Report #{record.reportId}</Text>
          <View style={styles.statusChip}>
            <Text style={styles.statusChipLabel}>{record.statusLabel}</Text>
          </View>
        </View>
        <Text style={styles.fieldLabel}>Location</Text>
        <Text style={styles.fieldValue}>{record.location}</Text>
        <Text style={styles.fieldLabel}>Vehicle</Text>
        <Text style={styles.fieldValue}>
          {record.plate}
          {record.vehicleText ? <Text style={styles.muted}> · {record.vehicleText}</Text> : null}
        </Text>
        <Text style={styles.fieldLabel}>Reported violation</Text>
        <Text style={styles.fieldValue}>{record.violation}</Text>
      </Card>

      <Card style={{ width: "100%" }}>
        <Text style={styles.sectionTitle}>Enforcement outcome</Text>
        <Text style={styles.outcome}>{record.outcomeLabel}</Text>
        {record.completedAtText ? <Text style={styles.muted}>Decided {record.completedAtText}</Text> : null}
        {record.chargeText ? (
          <>
            <Text style={styles.fieldLabel}>Parking charge</Text>
            <Text style={[styles.fieldValue, { color: colors.greenDark }]}>{record.chargeText}</Text>
          </>
        ) : null}
        {record.notes ? (
          <>
            <Text style={styles.fieldLabel}>Officer notes</Text>
            <Text style={styles.fieldValue}>{record.notes}</Text>
          </>
        ) : null}
      </Card>

      <Card style={{ width: "100%" }}>
        <Text style={styles.sectionTitle}>Inspection checklist</Text>
        {record.checklist ? (
          record.checklist.map((row) => {
            const a = ANSWER[row.answer];
            return (
              <View key={row.key} style={styles.checkRow} accessible accessibilityLabel={`${row.label}: ${a.text}`}>
                <Ionicons name={a.icon} size={18} color={a.color} />
                <Text style={styles.checkLabel}>{row.label}</Text>
                <Text style={[styles.checkAnswer, { color: a.color }]}>{a.text}</Text>
              </View>
            );
          })
        ) : (
          <Text style={[styles.muted, { marginTop: 6 }]}>No on-site inspection was recorded for this case.</Text>
        )}
      </Card>

      <Card style={{ width: "100%" }}>
        <View style={styles.headRow}>
          <Text style={styles.sectionTitle}>Citizen evidence</Text>
          <Text style={styles.muted}>{record.citizenEvidence.length} photos</Text>
        </View>
        {record.citizenEvidence.length > 0 ? (
          <EvidenceThumbnails
            items={record.citizenEvidence}
            thumbStyle={styles.thumb}
            max={4}
            style={{ gap: 6, marginTop: 10 }}
            onOpen={(index) => setGallery({ kind: "citizen", index })}
          />
        ) : (
          <Text style={[styles.muted, { marginTop: 6 }]}>The report photos are not available right now.</Text>
        )}
      </Card>

      <Card style={{ width: "100%" }}>
        <View style={styles.headRow}>
          <Text style={styles.sectionTitle}>Officer evidence</Text>
          {record.photosText ? <Text style={styles.muted}>{record.photosText}</Text> : null}
        </View>
        {record.officerEvidence.length > 0 ? (
          <EvidenceThumbnails
            items={record.officerEvidence}
            thumbStyle={styles.thumb}
            style={{ gap: 6, marginTop: 10 }}
            onOpen={(index) => setGallery({ kind: "officer", index })}
          />
        ) : (
          <Text style={[styles.muted, { marginTop: 6 }]}>No officer photos were recorded for this case.</Text>
        )}
      </Card>
    </>
  );

  const gal = (
    <EvidenceGallery
      items={gallery?.kind === "officer" ? record.officerEvidence : record.citizenEvidence}
      index={gallery?.index ?? null}
      onClose={() => setGallery(null)}
    />
  );

  if (asRecord) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <BackHeader title="Case Record" subtitle={`Case closed · ${record.outcomeLabel}`} onBack={leave} />
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 14 }}>{body}</ScrollView>
        {gal}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 20, alignItems: "center" }}>
        <SuccessMark style={styles.successCircle} />
        <FadeIn delay={180} style={{ width: "100%", alignItems: "center", gap: 14 }}>
          <View style={{ alignItems: "center" }}>
            <Text style={styles.title}>{record.checklist ? "Inspection Completed" : "Case Closed"}</Text>
            <Text style={styles.subtitle}>The outcome has been recorded.</Text>
          </View>
          {body}
        </FadeIn>

        <View style={{ width: "100%", marginTop: "auto", paddingTop: 20, gap: 10 }}>
          <GreenButton label="Next Case" icon="navigate" onPress={handleNextCase} />
          <GreenButton label="Return to Home" variant="outline" icon="home" onPress={() => resetToOfficerHome(router)} />
        </View>
      </ScrollView>
      {gal}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  successCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.greenLight, alignItems: "center", justifyContent: "center", marginTop: 12 },
  title: { fontSize: 22, fontWeight: "800", marginTop: 14 },
  subtitle: { fontSize: 13.5, color: colors.textSecondary, textAlign: "center", marginTop: 4 },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  reportId: { fontSize: 16, fontWeight: "800" },
  statusChip: { backgroundColor: colors.backgroundSunk, borderRadius: radius.chip, paddingHorizontal: 10, paddingVertical: 4 },
  statusChipLabel: { fontSize: 12, fontWeight: "800", color: colors.textSecondary },
  sectionTitle: { fontSize: 15, fontWeight: "800" },
  outcome: { fontSize: 17, fontWeight: "800", marginTop: 6 },
  fieldLabel: { fontSize: 11.5, fontWeight: "700", color: colors.textSecondary, marginTop: 10 },
  fieldValue: { fontSize: 14, fontWeight: "700", marginTop: 2 },
  muted: { fontSize: 12.5, color: colors.textSecondary, fontWeight: "500" },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  checkLabel: { flex: 1, fontSize: 13.5, fontWeight: "600" },
  checkAnswer: { fontSize: 12.5, fontWeight: "700" },
  thumb: { width: "100%", aspectRatio: 1, borderRadius: 10 },
});
