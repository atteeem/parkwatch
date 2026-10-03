import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, Image, Pressable, StyleSheet } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { radius } from "../../src/constants/spacing";
import { BackHeader } from "../../src/components/Header";
import { GreenButton } from "../../src/components/GreenButton";
import { useApp } from "../../src/context/AppContext";
import { describeDomainError } from "../../src/presentation/errors";
import { createSubmitGuard } from "../../src/presentation/submitGuard";
import { primaryCaseAction } from "../../src/presentation/officerViews";
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
  const { getCase, officerId, getInspection, setChecklistItem, confirmPlateBySimulatedScan, startInspection } = useApp();
  const c = getCase(id);
  const [error, setError] = useState<string | null>(null);
  const startGuard = useMemo(() => createSubmitGuard(), [c?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/officer/home"));

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

  const report = (r: { ok: boolean; error?: { code: string; message?: string } }) =>
    setError(r.ok || !r.error ? null : describeDomainError(r.error).message);

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
            <Text style={styles.locationSub}>#{c.reportId}</Text>
          </View>
          <View style={styles.plateChip}>
            <Text style={styles.plateChipLabel}>{c.plate}</Text>
          </View>
        </View>

        <View>
          <Image source={{ uri: c.images[0] }} style={styles.mainImage} />
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
          {CHECK_ROWS.map((row) => {
            const done = inspection[row.key] === true;
            const scanned = row.scan && done && inspection.plateConfirmedBySimulatedScan;
            return (
              <Pressable
                key={row.key}
                style={[styles.checkRow, done && styles.checkRowDone]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: done }}
                onPress={() => report(setChecklistItem(c.id, row.key, done ? null : true))}
              >
                <Ionicons name={row.icon} size={20} color={done ? "#06210F" : colors.textSecondary} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[styles.checkTitle, done && { color: "#06210F" }]}>{row.title}</Text>
                  <Text style={[styles.checkBody, done && { color: "#0B3D22" }]}>
                    {scanned ? "Confirmed by simulated scan (dev only, no plate recognition)" : row.body}
                  </Text>
                </View>
                {row.scan && !done ? (
                  <Pressable
                    style={styles.scanBtn}
                    hitSlop={6}
                    accessibilityLabel="Simulated plate scan"
                    onPress={() => report(confirmPlateBySimulatedScan(c.id))}
                  >
                    <Text style={styles.scanLabel}>Scan</Text>
                  </Pressable>
                ) : (
                  <Ionicons name={done ? "checkmark-circle" : "ellipse-outline"} size={22} color={done ? "#06210F" : colors.border} />
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
                  style={[styles.photoSlot, uri && styles.photoSlotDone]}
                  onPress={() =>
                    router.push({ pathname: "/officer/violation-photo", params: { id: c.id, target: t.key } })
                  }
                >
                  {uri ? (
                    <Image source={{ uri }} style={StyleSheet.absoluteFillObject as any} />
                  ) : (
                    <Ionicons name="camera-outline" size={22} color={colors.greenDark} />
                  )}
                  <Text style={[styles.photoLabel, uri && styles.photoLabelDone]} numberOfLines={1}>
                    {t.label}
                  </Text>
                  {!uri && <Text style={styles.requiredLabel}>Required for a charge</Text>}
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
        <Text style={styles.readyHint}>
          {inspection.readyForCharge
            ? "Ready: all checks confirmed and all four photos taken."
            : "A parking charge needs all four checks and four photos. Closing without a charge does not."}
        </Text>
        <GreenButton
          label="Continue"
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
  checkTitle: { fontWeight: "700", fontSize: 14 },
  checkBody: { fontSize: 11.5, color: colors.textSecondary, marginTop: 2 },
  scanBtn: { borderWidth: 1.5, borderColor: colors.greenDark, borderRadius: radius.chip, paddingHorizontal: 12, paddingVertical: 6 },
  scanLabel: { color: colors.greenDark, fontWeight: "700", fontSize: 12 },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  photoSlot: {
    width: "47%",
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
  photoLabel: { fontWeight: "700", fontSize: 12, textAlign: "center", position: "absolute", bottom: 20 },
  photoLabelDone: { color: "#fff", backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 6, borderRadius: 6 },
  requiredLabel: { fontSize: 10, color: colors.textLight, position: "absolute", bottom: 6 },
  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 10, backgroundColor: colors.background },
  readyHint: { fontSize: 11.5, color: colors.textSecondary, textAlign: "center", marginBottom: 8 },
  stateBox: { alignItems: "center", padding: 32 },
  stateText: { color: colors.textSecondary, fontSize: 14, textAlign: "center" },
  errorInline: { color: "#B3261E", fontSize: 12.5, fontWeight: "600", marginTop: 10, textAlign: "center" },
  errorBanner: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.redLight, borderRadius: 10, padding: 10 },
  errorText: { flex: 1, fontSize: 12.5, color: "#B3261E", fontWeight: "600" },
});
