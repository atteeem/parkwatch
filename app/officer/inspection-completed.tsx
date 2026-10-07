import React from "react";
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
import { useApp, useCaseDetailLoad, usePagedList, useQueuePosition } from "../../src/context/AppContext";
import { DetailLoading } from "../../src/components/CoreDataGate";
import { EvidencePhoto } from "../../src/components/EvidencePhoto";
import { useForegroundLocation } from "../../src/location/useForegroundLocation";
import { filterQueue, sortQueue, toCompletionSummary, withDistances } from "../../src/presentation/officerViews";
import { SuccessMark } from "../../src/components/motion/SuccessMark";
import { FadeIn } from "../../src/components/motion/FadeIn";
import { openNextCase, resetToOfficerHome } from "../../src/navigation/officerNavigation";

// OFF-09. Rendered entirely from the stored case: the charge line appears
// only for CHARGE_ISSUED and the photo count is the real one.
export default function InspectionCompleted() {
  const router = useRouter();
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  // Opened as a record (notification) rather than right after deciding: Back returns there.
  const leave = () => (from && router.canGoBack() ? router.back() : resetToOfficerHome(router));
  // Server mode: (re)load this case when the screen opens, so it is current even off the loaded pages.
  const caseLoad = useCaseDetailLoad(id);
  const { getCase, getCaseDetail, getInspection, ensureCase } = useApp();
  const freshQueue = usePagedList({ kind: "queue", filter: "New" });
  const location = useForegroundLocation();
  const c = getCase(id);
  const summary = c ? toCompletionSummary(c, getInspection(c.id), getCaseDetail(c.id)?.outcomeNotes) : null;

  if (caseLoad.loading && (!c || !summary)) return <DetailLoading />;

  if (!c || !summary) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <BackHeader title="Case Result" onBack={leave} />
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

  const rows: { label: string; value?: string }[] = [
    ...(summary.photosText ? [{ label: "On-site inspection" }, { label: "Officer photos", value: summary.photosText }] : []),
    { label: summary.outcomeLabel, value: summary.chargeText },
    { label: "Case status", value: "Closed" },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, alignItems: "center" }}>
        <SuccessMark style={styles.successCircle} />
        <FadeIn delay={180} style={{ width: "100%", alignItems: "center" }}>
        <Text style={styles.title}>{summary.photosText ? "Inspection Completed" : "Case Closed"}</Text>
        <Text style={styles.subtitle}>Thank you! The outcome has been recorded.</Text>

        <Card style={{ width: "100%", marginTop: 22 }}>
          <View style={{ flexDirection: "row" }}>
            <EvidencePhoto uri={c.images[0]} style={styles.img} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.location}>
                <Ionicons name="location" size={12} color={colors.greenDark} /> {summary.location}
              </Text>
              {summary.completedAtText && <Text style={styles.meta}>{summary.completedAtText}</Text>}
              <Text style={styles.fieldLabel}>Vehicle</Text>
              <Text style={styles.fieldValue}>{summary.plate}</Text>
              <Text style={styles.fieldLabel}>Violation</Text>
              <Text style={styles.fieldValue}>{summary.violation}</Text>
              <Text style={styles.fieldLabel}>Report ID</Text>
              <Text style={styles.fieldValue}>#{summary.reportId}</Text>
              {summary.chargeText && (
                <>
                  <Text style={styles.fieldLabel}>Parking charge</Text>
                  <Text style={[styles.fieldValue, { color: colors.greenDark }]}>{summary.chargeText}</Text>
                </>
              )}
              {summary.notes && (
                <>
                  <Text style={styles.fieldLabel}>Notes</Text>
                  <Text style={styles.fieldValue}>{summary.notes}</Text>
                </>
              )}
            </View>
          </View>
        </Card>

        <Text style={styles.summaryHeading}>Case Summary</Text>
        <View style={{ width: "100%", gap: 8 }}>
          {rows.map((row) => (
            <View key={row.label} style={styles.summaryRow}>
              <Text style={styles.summaryRowLabel}>{row.label}</Text>
              {row.value && <Text style={styles.summaryRowValue}>{row.value}</Text>}
              <Ionicons name="checkmark-circle" size={18} color="#06210F" />
            </View>
          ))}
        </View>
        </FadeIn>

        <View style={{ width: "100%", marginTop: "auto", paddingTop: 20, gap: 10 }}>
          <GreenButton label="Next Case" icon="navigate" onPress={handleNextCase} />
          <GreenButton label="Return to Home" variant="outline" icon="home" onPress={() => resetToOfficerHome(router)} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  stateText: { padding: 24, color: colors.textSecondary, fontSize: 14, textAlign: "center" },
  safe: { flex: 1, backgroundColor: colors.background },
  successCircle: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.greenLight, alignItems: "center", justifyContent: "center", marginTop: 20 },
  title: { fontSize: 22, fontWeight: "800", marginTop: 16 },
  subtitle: { fontSize: 13.5, color: colors.textSecondary, textAlign: "center", marginTop: 6 },
  img: { width: 84, height: 84, borderRadius: radius.photo },
  location: { fontWeight: "800", fontSize: 14 },
  meta: { fontSize: 11.5, color: colors.textSecondary, marginTop: 3 },
  fieldLabel: { fontSize: 10.5, color: colors.textLight, marginTop: 6 },
  fieldValue: { fontSize: 13, fontWeight: "700" },
  summaryHeading: { fontSize: 16, fontWeight: "800", alignSelf: "flex-start", marginTop: 18, marginBottom: 10 },
  summaryRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.green, borderRadius: radius.button, paddingHorizontal: 14, paddingVertical: 13 },
  summaryRowLabel: { flex: 1, fontWeight: "800", fontSize: 13.5, color: "#06210F" },
  summaryRowValue: { fontWeight: "700", fontSize: 13, color: "#06210F", marginRight: 10 },
});
