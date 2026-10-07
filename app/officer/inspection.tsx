import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { radius } from "../../src/constants/spacing";
import { BackHeader } from "../../src/components/Header";
import { GreenButton } from "../../src/components/GreenButton";
import { settle, useApp, useCaseDetailLoad } from "../../src/context/AppContext";
import { DetailLoading } from "../../src/components/CoreDataGate";
import { EvidencePhoto } from "../../src/components/EvidencePhoto";
import { describeDomainError } from "../../src/presentation/errors";
import { useGuardedAction } from "../../src/presentation/useGuardedAction";
import { primaryCaseAction } from "../../src/presentation/officerViews";
import { formatDateTime } from "../../src/presentation/time";
import { InspectionCheckKey, OfficerPhotoKey } from "../../src/presentation/viewModels";

const CHECK_ROWS: {
  key: InspectionCheckKey;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  scan?: boolean;
}[] = [
  { key: "vehiclePresent", icon: "car", title: "Vehicle still present", body: "The vehicle is still at the location" },
  { key: "plateMatched", icon: "pricetag", title: "License plate matches", body: "License plate matches the report", scan: true },
  { key: "violationConfirmed", icon: "checkmark-circle-outline", title: "Violation confirmed", body: "The parking violation is still ongoing" },
  { key: "restrictionVerified", icon: "flag-outline", title: "Parking restriction verified", body: "Parking rules at the location confirmed" },
];

const PHOTO_TARGETS: readonly { key: OfficerPhotoKey; label: string }[] = [
  { key: "overview", label: "Vehicle overview" },
  { key: "plate", label: "License plate" },
  { key: "sign", label: "Parking sign" },
  { key: "context", label: "Violation context" },
];

// OFF-06. Everything here reads/writes THIS case's inspection only. Opening
// the screen never creates or changes anything.
export default function OnSiteInspection() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  // Server mode: (re)load this case when the screen opens, so it is current even off the loaded pages.
  const caseLoad = useCaseDetailLoad(id);
  const { getCase, officerId, getInspection, setChecklistItem, confirmPlateBySimulatedScan, startInspection } = useApp();
  const c = getCase(id);
  const [error, setError] = useState<string | null>(null);
  // One checklist change at a time: further taps are ignored until the server (or store) answers.
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const startGuard = useGuardedAction(c?.status);
  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/officer/home"));

  if (caseLoad.loading && (!c || !getInspection(c.id).exists)) return <DetailLoading />;

  if (!c) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <BackHeader title="On-Site Inspection" onBack={goBack} />
        <View style={styles.stateBox}>
          <Text style={styles.stateText}>This case could not be found.</Text>
          <GreenButton label="Back to Queue" small onPress={() => router.replace("/officer/queue")} style={{ marginTop: 16 }} />
        </View>
      </SafeAreaView>
    );
  }

  const inspection = getInspection(c.id);
  const action = primaryCaseAction(c, officerId);

  // Not in an inspection state for this officer: explain instead of mutating.
  if (action !== "CONTINUE_INSPECTION" || !inspection.exists) {
    const canStart = action === "CONTINUE_ROUTE" || action === "START_INSPECTION" || (action === "CONTINUE_INSPECTION" && !inspection.exists);
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <BackHeader title="On-Site Inspection" onBack={goBack} />
        <View style={styles.stateBox}>
          <Text style={styles.stateText}>
            {action === "VIEW_RESULT"
              ? "This case is closed."
              : action === "TAKEN"
                ? "This case is assigned to another officer."
                : "The inspection for this case has not started."}
          </Text>
          {error && <Text style={styles.errorInline}>{error}</Text>}
          {action === "VIEW_RESULT" && (
            <GreenButton
              label="View Result"
              small
              style={{ marginTop: 16 }}
              onPress={() => router.replace({ pathname: "/officer/inspection-completed", params: { id: c.id } })}
            />
          )}
          {canStart && (
            <GreenButton
              label="Start On-site Inspection"
              small
              loading={startGuard.busy}
              disabled={startGuard.busy}
              style={{ marginTop: 16 }}
              onPress={() =>
                startGuard.run(() => startInspection(c.id), {
                  onSuccess: () => setError(null),
                  onError: (e) => setError(describeDomainError(e).message),
                })
              }
            />
          )}
        </View>
      </SafeAreaView>
    );
  }

  const runCheck = (key: string, action: () => Parameters<typeof settle>[0]) => {
    if (pendingKey) return;
    setPendingKey(key);
    void settle(action()).then((r) => {
      setPendingKey(null);
      setError(r.ok ? null : describeDomainError(r.error).message);
    });
  };

  const checksCompleted = inspection.checklistConfirmed;
  const photosCompleted = inspection.photosCaptured;
  const totalCompleted = checksCompleted + (inspection.evidenceComplete ? 1 : 0);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <BackHeader title="On-Site Inspection" subtitle="Verify the violation and capture evidence" onBack={goBack} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 150 + insets.bottom, gap: 16 }}>
        <View style={styles.locationBar}>
          <Ionicons name="location" size={15} color={colors.greenDark} />
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={styles.locationTitle}>{c.location}</Text>
            <Text style={styles.locationSub}>#{c.reportId} {"•"} {formatDateTime(c.submittedAt)}</Text>
          </View>
          <View style={styles.plateChip}>
            <Text style={styles.plateChipLabel}>{c.plate}</Text>
          </View>
        </View>

        <View>
          <EvidencePhoto uri={c.images[0]} style={styles.mainImage} />
          <View style={styles.imageCounter}>
            <Text style={styles.imageCounterLabel}>1 / {c.images.length}</Text>
          </View>
        </View>

        {error && (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle" size={15} color="#B3261E" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 10 }}>
            <Text style={styles.sectionTitle}>Inspection Checklist</Text>
            <Text style={styles.completedLabel}>
              <Text style={{ color: colors.greenDark }}>{totalCompleted}</Text> / {CHECK_ROWS.length + 1} completed
            </Text>
          </View>
          <Text style={styles.checkHint}>Tap to confirm. Tap again to record "not confirmed".</Text>
          {CHECK_ROWS.map((row) => {
            // Three states, kept distinct for the audit trail: yes / no / unanswered.
            const value = inspection[row.key];
            const yes = value === true;
            const no = value === false;
            const confirmedPlate = row.scan && yes && inspection.plateConfirmedBySimulatedScan;
            const next = yes ? false : no ? null : true;
            return (
              <Pressable
                key={row.key}
                style={[styles.checkRow, yes && styles.checkRowDone, no && styles.checkRowNo]}
                accessibilityRole="button"
                accessibilityLabel={`${row.title}: ${yes ? "confirmed" : no ? "not confirmed" : "not answered"}`}
                accessibilityState={{ busy: pendingKey === row.key, disabled: pendingKey !== null }}
                disabled={pendingKey !== null}
                onPress={() => runCheck(row.key, () => setChecklistItem(c.id, row.key, next))}
              >
                <Ionicons name={row.icon} size={20} color={yes ? "#06210F" : no ? colors.red : colors.textSecondary} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[styles.checkTitle, yes && { color: "#06210F" }]}>{row.title}</Text>
                  <Text style={[styles.checkBody, yes && { color: "#0B3D22" }, no && styles.checkBodyNo]}>
                    {pendingKey === row.key ? "Saving…" : no ? "Not confirmed" : confirmedPlate ? "Plate confirmed against the report" : row.body}
                  </Text>
                </View>
                {row.scan && value == null ? (
                  <Pressable
                    style={styles.scanBtn}
                    hitSlop={6}
                    accessibilityLabel="Confirm plate"
                    disabled={pendingKey !== null}
                    onPress={() => runCheck(row.key, () => confirmPlateBySimulatedScan(c.id))}
                  >
                    <Text style={styles.scanLabel}>Confirm Plate</Text>
                  </Pressable>
                ) : (
                  <Ionicons
                    name={yes ? "checkmark-circle" : no ? "close-circle" : "ellipse-outline"}
                    size={22}
                    color={yes ? "#06210F" : no ? colors.red : colors.border}
                  />
                )}
              </Pressable>
            );
          })}
          {/* Derived row: reflects the four officer photos; not tappable. */}
          <View style={[styles.checkRow, inspection.evidenceComplete && styles.checkRowDone]}>
            <Ionicons name="camera" size={20} color={inspection.evidenceComplete ? "#06210F" : colors.textSecondary} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.checkTitle, inspection.evidenceComplete && { color: "#06210F" }]}>Required evidence captured</Text>
              <Text style={[styles.checkBody, inspection.evidenceComplete && { color: "#0B3D22" }]}>
                {photosCompleted} / 4 officer photos taken
              </Text>
            </View>
            <Ionicons
              name={inspection.evidenceComplete ? "checkmark-circle" : "ellipse-outline"}
              size={22}
              color={inspection.evidenceComplete ? "#06210F" : colors.border}
            />
          </View>
        </View>

        <View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 10 }}>
            <Text style={styles.sectionTitle}>Officer Photos</Text>
            <Text style={styles.completedLabel}>
              <Text style={{ color: colors.greenDark }}>{photosCompleted}</Text> / 4 completed
            </Text>
          </View>
          <View style={styles.photoGrid}>
            {PHOTO_TARGETS.map((t) => {
              const uri = inspection.officerPhotos[t.key];
              return (
                <Pressable
                  key={t.key}
                  style={styles.photoCell}
                  accessibilityLabel={`${t.label} photo`}
                  onPress={() =>
                    router.push({ pathname: "/officer/violation-photo", params: { id: c.id, target: t.key } })
                  }
                >
                  <View style={[styles.photoSlot, uri && styles.photoSlotDone]}>
                    {uri ? (
                      <EvidencePhoto uri={uri} style={StyleSheet.absoluteFill} compact />
                    ) : (
                      <Ionicons name="camera-outline" size={22} color={colors.greenDark} />
                    )}
                  </View>
                  <Text style={styles.photoLabel} numberOfLines={2}>
                    {t.label}
                  </Text>
                  <Text style={[styles.requiredLabel, uri && { color: colors.greenDark }]}>{uri ? "Captured" : "Required"}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
        <Text style={styles.readyHint}>
          {!inspection.hasActivity
            ? "Record at least one check or photo to continue."
            : inspection.readyForCharge
              ? "Ready: all checks confirmed and all four photos taken."
              : "A parking charge needs all four checks and four photos. Closing without a charge does not."}
        </Text>
        <GreenButton
          label="Continue"
          disabled={!inspection.hasActivity}
          onPress={() => router.push({ pathname: "/officer/inspection-result", params: { id: c.id } })}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  locationBar: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 14 },
  locationTitle: { fontWeight: "700", fontSize: 14 },
  locationSub: { fontSize: 11.5, color: colors.textSecondary, marginTop: 2 },
  plateChip: { backgroundColor: colors.green, borderRadius: radius.chip, paddingHorizontal: 12, paddingVertical: 6 },
  plateChipLabel: { fontWeight: "800", color: "#06210F" },
  mainImage: { width: "100%", height: 200, borderRadius: radius.card },
  imageCounter: { position: "absolute", left: 10, bottom: 10, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: radius.chip, paddingHorizontal: 10, paddingVertical: 4 },
  imageCounterLabel: { color: "#fff", fontWeight: "700", fontSize: 11.5 },
  sectionTitle: { fontSize: 17, fontWeight: "800" },
  completedLabel: { fontSize: 12.5, color: colors.textSecondary, fontWeight: "600" },
  checkRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 14, marginBottom: 10 },
  checkRowDone: { backgroundColor: colors.green, borderColor: colors.green },
  checkRowNo: { backgroundColor: colors.redLight, borderColor: "#F2B8B5" },
  checkBodyNo: { color: "#B3261E", fontWeight: "700" },
  checkHint: { fontSize: 11.5, color: colors.textLight, marginTop: -4, marginBottom: 10 },
  checkTitle: { fontWeight: "700", fontSize: 14 },
  checkBody: { fontSize: 11.5, color: colors.textSecondary, marginTop: 2 },
  scanBtn: { borderWidth: 1.5, borderColor: colors.greenDark, borderRadius: radius.chip, paddingHorizontal: 12, paddingVertical: 6 },
  scanLabel: { color: colors.greenDark, fontWeight: "700", fontSize: 12 },
  photoGrid: { flexDirection: "row", gap: 8 },
  photoCell: { flex: 1, alignItems: "center" },
  photoSlot: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    overflow: "hidden",
    backgroundColor: colors.backgroundSunk,
  },
  photoSlotDone: { borderStyle: "solid", borderColor: colors.green },
  photoLabel: { fontWeight: "700", fontSize: 11, textAlign: "center", marginTop: 6 },
  requiredLabel: { fontSize: 10.5, color: colors.textLight, marginTop: 1 },
  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 10, backgroundColor: colors.background },
  readyHint: { fontSize: 11.5, color: colors.textSecondary, textAlign: "center", marginBottom: 8 },
  stateBox: { alignItems: "center", padding: 32 },
  stateText: { color: colors.textSecondary, fontSize: 14, textAlign: "center" },
  errorInline: { color: "#B3261E", fontSize: 12.5, fontWeight: "600", marginTop: 10, textAlign: "center" },
  errorBanner: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.redLight, borderRadius: 10, padding: 10 },
  errorText: { flex: 1, fontSize: 12.5, color: "#B3261E", fontWeight: "600" },
});
