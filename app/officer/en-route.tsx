import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { radius, shadow } from "../../src/constants/spacing";
import { BackHeader } from "../../src/components/Header";
import { GreenButton } from "../../src/components/GreenButton";
import { StatusChip } from "../../src/components/StatusChip";
import { ConfirmDialog } from "../../src/components/ConfirmDialog";
import { LiveMap } from "../../src/components/map/LiveMap";
import { useApp } from "../../src/context/AppContext";
import { EvidencePhoto } from "../../src/components/EvidencePhoto";
import { useForegroundLocation } from "../../src/location/useForegroundLocation";
import { formatDistance, straightLineDistance } from "../../src/geo/distance";
import { officerCaseMarkers } from "../../src/map/mapLogic";
import { describeDomainError } from "../../src/presentation/errors";
import { createSubmitGuard } from "../../src/presentation/submitGuard";
import { primaryCaseAction } from "../../src/presentation/officerViews";
import { showCompletedCase } from "../../src/navigation/officerNavigation";

// OFF-05. Straight-line distance from the officer's foreground GPS only:
// no routing, no ETA, no traffic (none of which the MVP can know).
export default function EnRoute() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getCase, officerId, startInspection, completeCase } = useApp();
  const c = getCase(id);
  // Live foreground updates while this screen is open (released on leave).
  const location = useForegroundLocation({ watch: true });
  const officerFix = location.permission === "granted" ? location.fix : undefined;
  const [error, setError] = useState<string | null>(null);
  const [confirmMoved, setConfirmMoved] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const guard = useMemo(() => createSubmitGuard(), [c?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!c) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <BackHeader title="En Route" onBack={() => router.back()} />
        <View style={styles.notFound}>
          <Text style={styles.notFoundText}>This case could not be found.</Text>
          <GreenButton label="Back to Queue" small onPress={() => router.replace("/officer/queue")} style={{ marginTop: 16 }} />
        </View>
      </SafeAreaView>
    );
  }

  const action = primaryCaseAction(c, officerId);
  const distance = straightLineDistance(officerFix, c.coordinates);
  const isMineInTransit = action === "CONTINUE_ROUTE" || action === "START_INSPECTION";
  const openDetails = () => router.push({ pathname: "/officer/report-details", params: { id: c.id } });

  const handleStartInspection = () => {
    setError(null);
    if (action === "CONTINUE_INSPECTION") {
      router.push({ pathname: "/officer/inspection", params: { id: c.id } });
      return;
    }
    guard.run(() => startInspection(c.id), {
      onSuccess: () => router.push({ pathname: "/officer/inspection", params: { id: c.id } }),
      onError: (e) => setError(describeDomainError(e).message),
    });
  };

  const handleVehicleMoved = () => {
    guard.run(() => completeCase(c.id, "VEHICLE_MOVED"), {
      onSuccess: () => {
        setConfirmMoved(false);
        showCompletedCase(router, c.id);
      },
      onError: (e) => setDialogError(describeDomainError(e).message),
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerRow}>
        {router.canGoBack() && (
          <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
          </Pressable>
        )}
        <Text style={styles.title}>En Route</Text>
        <View style={styles.onDutyChip}>
          <View style={styles.onDutyDot} />
          <Text style={styles.onDutyLabel}>On Duty</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: Math.max(insets.bottom, 12) + 20 }}>
        <Pressable style={styles.caseCard} onPress={openDetails}>
          <EvidencePhoto uri={c.images[0]} style={styles.caseImg} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={styles.caseTitle}>{c.violation}</Text>
              {c.priority === "high" && <StatusChip status="high" />}
            </View>
            <Text style={styles.caseMeta}>
              <Ionicons name="location" size={11} /> {c.location}
            </Text>
            <Text style={styles.caseMeta}>
              <Ionicons name="time" size={11} /> Reported {c.reportedAgo}
            </Text>
            <Text style={styles.caseReliability}>
              <Ionicons name="shield-checkmark" size={11} color={colors.greenDark} /> Reporter Reliability: {c.reporterReliability}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textLight} />
        </Pressable>

        <View style={styles.navCard}>
          <View style={styles.navTopBar}>
            <Text style={styles.navTopLabel}>
              <Ionicons name="navigate" size={13} color={colors.green} /> Navigating to location
            </Text>
            {c.coordinates && (
              <Pressable
                style={styles.openMapsBtn}
                onPress={() => router.push({ pathname: "/officer/map", params: { caseId: c.id } })}
              >
                <Text style={styles.openMapsLabel}>Open in Maps</Text>
                <Ionicons name="map-outline" size={13} color="#fff" />
              </Pressable>
            )}
          </View>
          <Text style={styles.navAddress}>{c.location}</Text>

          {c.coordinates ? (
            <LiveMap
              style={styles.navMap}
              interactive={false}
              following={false}
              focusPoint={c.coordinates}
              markers={officerCaseMarkers([c])}
              userFix={officerFix}
            />
          ) : (
            <View style={[styles.navMap, styles.navMapEmpty]}>
              <Text style={styles.navBottomLabel}>This report has no GPS position. Use the address.</Text>
            </View>
          )}

          <View style={styles.navBottomBar}>
            <View style={{ alignItems: "center" }}>
              <Text style={styles.navBottomLabel}>Distance (straight line)</Text>
              <Text style={styles.navBottomValue}>{distance !== null ? formatDistance(distance) : "Unknown"}</Text>
            </View>
            <View style={{ alignItems: "center" }}>
              <Text style={styles.navBottomLabel}>Your location</Text>
              <Text style={styles.navBottomValue}>
                {officerFix
                  ? officerFix.accuracyMeters !== undefined
                    ? `±${Math.round(officerFix.accuracyMeters)} m`
                    : "On"
                  : location.permission === "granted"
                    ? "Locating…"
                    : "Off"}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.statusRow}>
          <Ionicons name="locate" size={18} color={colors.greenDark} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.statusTitle}>You are en route to the location</Text>
            <Text style={styles.statusSub}>Please arrive on site and inspect the vehicle.</Text>
          </View>
        </View>

        <View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
            <Text style={styles.originalReportLabel}>Original Report</Text>
            <Pressable onPress={openDetails}>
              <Text style={styles.viewDetails}>View Details</Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {c.images.slice(0, 4).map((uri, i) => (
              <EvidencePhoto key={i} uri={uri} style={styles.originalThumb} compact />
            ))}
          </View>
        </View>

        {error && (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle" size={15} color="#B3261E" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {action === "VIEW_RESULT" ? (
          <GreenButton
            label="View Result"
            onPress={() => router.push({ pathname: "/officer/inspection-completed", params: { id: c.id } })}
          />
        ) : (
          <>
            <GreenButton
              label={action === "CONTINUE_INSPECTION" ? "Continue Inspection" : "Start On-site Inspection"}
              icon="clipboard"
              disabled={!(isMineInTransit || action === "CONTINUE_INSPECTION")}
              onPress={handleStartInspection}
              trailingIcon={null}
            />
            <Text style={styles.subCaption}>I have arrived at the location</Text>

            <GreenButton
              label="Vehicle moved / not found"
              variant="destructive"
              trailingIcon={null}
              icon="car"
              disabled={!isMineInTransit}
              onPress={() => {
                setDialogError(null);
                setConfirmMoved(true);
              }}
            />
            <Text style={styles.subCaption}>The vehicle is no longer here</Text>

            {/* TODO(dev): releasing a case back to the queue is not defined in the
                domain lifecycle yet (EN_ROUTE -> NEW is not an allowed transition). */}
            <GreenButton label="Release Case" variant="gray" trailingIcon={null} icon="close-circle" disabled />
            <Text style={styles.subCaption}>Returning a case to the queue is not available yet</Text>
          </>
        )}
      </ScrollView>

      <ConfirmDialog
        visible={confirmMoved}
        title="Vehicle moved or not found?"
        message="The case will be closed as Vehicle moved. No parking charge is issued and the reporter's reward is cancelled. This cannot be undone."
        confirmLabel="Close Case"
        destructive
        error={dialogError}
        onConfirm={handleVehicleMoved}
        onCancel={() => setConfirmMoved(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  headerRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", paddingHorizontal: 20, paddingTop: 6 },
  title: { fontSize: 22, fontWeight: "800" },
  onDutyChip: { position: "absolute", right: 20, top: 8, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.greenLight, borderRadius: radius.chip, paddingHorizontal: 10, paddingVertical: 5 },
  onDutyDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.greenDark },
  onDutyLabel: { fontSize: 11, fontWeight: "700", color: colors.greenDark },
  caseCard: { flexDirection: "row", alignItems: "center", backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 14, ...shadow.card },
  caseImg: { width: 60, height: 60, borderRadius: radius.photo },
  caseTitle: { fontWeight: "800", fontSize: 15 },
  caseMeta: { fontSize: 11.5, color: colors.textSecondary, marginTop: 2 },
  caseReliability: { fontSize: 11, fontWeight: "700", color: colors.greenDark, marginTop: 3 },
  navCard: { backgroundColor: "#12140F", borderRadius: radius.card, overflow: "hidden" },
  navTopBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 14, paddingBottom: 6 },
  navTopLabel: { color: colors.green, fontWeight: "800", fontSize: 12.5 },
  openMapsBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: radius.chip, paddingHorizontal: 10, paddingVertical: 6 },
  openMapsLabel: { color: "#fff", fontWeight: "700", fontSize: 11.5 },
  navAddress: { color: "#fff", fontWeight: "800", fontSize: 15, paddingHorizontal: 14, paddingBottom: 10 },
  navMap: { height: 220, backgroundColor: "#1B1D18" },
  navMapEmpty: { alignItems: "center", justifyContent: "center", padding: 20 },
  backBtn: { position: "absolute", left: 16, top: 8, width: 34, height: 34, borderRadius: 17, backgroundColor: colors.backgroundSunk, alignItems: "center", justifyContent: "center" },
  notFound: { alignItems: "center", padding: 32 },
  notFoundText: { color: colors.textSecondary, fontSize: 14 },
  errorBanner: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.redLight, borderRadius: 10, padding: 10 },
  errorText: { flex: 1, fontSize: 12.5, color: "#B3261E", fontWeight: "600" },
  navBottomBar: { flexDirection: "row", justifyContent: "space-around", padding: 14, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.1)" },
  navBottomLabel: { color: "#8C948E", fontSize: 10.5 },
  navBottomValue: { color: colors.green, fontWeight: "800", fontSize: 14, marginTop: 2 },
  statusRow: { flexDirection: "row", alignItems: "flex-start", backgroundColor: colors.greenLight, borderRadius: radius.card, padding: 14 },
  statusTitle: { fontWeight: "800", fontSize: 13.5, color: "#0B7A38" },
  statusSub: { fontSize: 11.5, color: "#0B7A38", marginTop: 2 },
  originalReportLabel: { fontWeight: "800", fontSize: 14 },
  viewDetails: { color: colors.greenDark, fontWeight: "700", fontSize: 12.5 },
  originalThumb: { flex: 1, aspectRatio: 1, borderRadius: 10 },
  subCaption: { fontSize: 11, color: colors.textSecondary, textAlign: "center", marginTop: -6 },
});
