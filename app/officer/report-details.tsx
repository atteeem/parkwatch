import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, Image, Pressable, StyleSheet } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { radius } from "../../src/constants/spacing";
import { BackHeader } from "../../src/components/Header";
import { GreenButton } from "../../src/components/GreenButton";
import { Card } from "../../src/components/Card";
import { StatusChip } from "../../src/components/StatusChip";
import { ConfirmDialog } from "../../src/components/ConfirmDialog";
import { LiveMap } from "../../src/components/map/LiveMap";
import { useApp } from "../../src/context/AppContext";
import { useForegroundLocation } from "../../src/location/useForegroundLocation";
import { formatDistance, straightLineDistance } from "../../src/geo/distance";
import { officerCaseMarkers } from "../../src/map/mapLogic";
import { describeDomainError } from "../../src/presentation/errors";
import { createSubmitGuard } from "../../src/presentation/submitGuard";
import {
  CASE_ACTION_LABEL,
  canDecideAtDesk,
  primaryCaseAction,
  systemChecks,
} from "../../src/presentation/officerViews";
import { showCompletedCase } from "../../src/navigation/officerNavigation";

type DeskDecision = "REPORT_REJECTED" | "DUPLICATE";

const DESK_CONFIRM: Record<DeskDecision, { title: string; message: string; confirm: string }> = {
  REPORT_REJECTED: {
    title: "Reject this report?",
    message: "The case will be closed as Rejected. No parking charge is issued and the reporter's reward is cancelled. This cannot be undone.",
    confirm: "Reject Report",
  },
  DUPLICATE: {
    title: "Mark as duplicate?",
    message: "The case will be closed as a duplicate of an existing report. No parking charge is issued. This cannot be undone.",
    confirm: "Mark as Duplicate",
  },
};

// OFF-04. Opening this screen never changes the case; only the buttons do,
// and each one checks its result before navigating.
export default function ReportDetails() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getCaseDetail, officerId, acceptCase, startEnRoute, startInspection, completeCase } = useApp();
  const detail = getCaseDetail(id);
  const c = detail?.case;
  const location = useForegroundLocation();
  const officerFix = location.permission === "granted" ? location.fix : undefined;
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<DeskDecision | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  // One guard per case stage: a second tap in the same stage is ignored.
  const guard = useMemo(() => createSubmitGuard(), [c?.status, c?.assignedOfficerId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!detail || !c) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <BackHeader title="Report Details" onBack={() => router.back()} />
        <View style={styles.notFound}>
          <Ionicons name="document-text-outline" size={32} color={colors.textLight} />
          <Text style={styles.notFoundText}>This case could not be found.</Text>
          <GreenButton label="Back to Queue" small onPress={() => router.replace("/officer/queue")} style={{ marginTop: 16 }} />
        </View>
      </SafeAreaView>
    );
  }

  const action = primaryCaseAction(c, officerId);
  const distance = straightLineDistance(officerFix, c.coordinates);
  const deskAllowed = canDecideAtDesk(c, officerId);

  const handlePrimary = () => {
    setError(null);
    const go = (pathname: string) => router.push({ pathname: pathname as any, params: { id: c.id } });
    const onError = (e: { code: string; message?: string }) => setError(describeDomainError(e).message);
    switch (action) {
      case "ACCEPT":
        guard.run(() => acceptCase(c.id), { onSuccess: () => go("/officer/en-route"), onError });
        return;
      case "START_ROUTE":
        guard.run(() => startEnRoute(c.id), { onSuccess: () => go("/officer/en-route"), onError });
        return;
      case "START_INSPECTION":
        guard.run(() => startInspection(c.id), { onSuccess: () => go("/officer/inspection"), onError });
        return;
      case "CONTINUE_ROUTE":
        return go("/officer/en-route");
      case "CONTINUE_INSPECTION":
        return go("/officer/inspection");
      case "VIEW_RESULT":
        return go("/officer/inspection-completed");
      case "TAKEN":
        return;
    }
  };

  const confirmDecision = () => {
    if (!decision) return;
    guard.run(() => completeCase(c.id, decision), {
      onSuccess: () => {
        setDecision(null);
        showCompletedCase(router, c.id);
      },
      onError: (e) => setDialogError(describeDomainError(e).message),
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <BackHeader title="Report Details" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 200 + insets.bottom, gap: 14 }}>
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <StatusChip status={c.status} />
            {c.priority === "high" && <StatusChip status="high" />}
            <Text style={styles.idText}>#{c.reportId}</Text>
          </View>
          <View style={styles.metaGrid}>
            <View style={styles.metaCell}>
              <Ionicons name="time-outline" size={15} color={colors.textSecondary} />
              <Text style={styles.metaLabel}>Reported</Text>
              <Text style={styles.metaValue}>{detail.submittedAtText}</Text>
            </View>
            <View style={styles.metaCell}>
              <Ionicons name="navigate-outline" size={15} color={colors.textSecondary} />
              <Text style={styles.metaLabel}>Distance</Text>
              <Text style={styles.metaValue}>{distance !== null ? `${formatDistance(distance)} away` : "Unknown"}</Text>
            </View>
            <View style={styles.metaCell}>
              <Ionicons name="location-outline" size={15} color={colors.textSecondary} />
              <Text style={styles.metaLabel}>Location</Text>
              <Text style={styles.metaValue} numberOfLines={2}>
                {c.location}
              </Text>
            </View>
          </View>
        </Card>

        <Card>
          <View style={{ flexDirection: "row" }}>
            <Image source={{ uri: c.images[0] }} style={styles.vehicleImg} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.plate}>{c.plate}</Text>
              <Text style={styles.fieldLabel}>Vehicle</Text>
              <Text style={styles.fieldValue}>
                {[c.vehicle, detail.vehicleColor].filter(Boolean).join(" · ") || "Not provided"}
              </Text>
              <Text style={styles.fieldLabel}>Reported Violation</Text>
              <Text style={styles.fieldValue}>{c.violation}</Text>
              <Text style={styles.fieldLabel}>Reporter Reliability</Text>
              <Text style={[styles.fieldValue, { color: colors.greenDark }]}>{c.reporterReliability}</Text>
              {c.reporterReliability === "High" && (
                <View style={styles.trustedBadge}>
                  <Ionicons name="shield-checkmark" size={12} color={colors.greenDark} />
                  <Text style={styles.trustedLabel}>Trusted Reporter</Text>
                </View>
              )}
            </View>
          </View>
        </Card>

        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={styles.reporterAvatar}>
              <Text style={styles.reporterInitials}>
                {c.reporterName
                  .split(" ")
                  .map((p) => p[0])
                  .join("")}
              </Text>
            </View>
            <Text style={{ fontWeight: "800", fontSize: 14, flex: 1 }}>{c.reporterName}</Text>
          </View>
          <View style={{ flexDirection: "row", marginTop: 10, gap: 20 }}>
            <Text style={styles.reporterStat}>
              <Ionicons name="shield-checkmark" size={12} color={colors.greenDark} /> Acceptance Rate <Text style={{ fontWeight: "800" }}>{c.reporterAcceptanceRate}%</Text>
            </Text>
            <Text style={styles.reporterStat}>
              <Ionicons name="checkmark-circle" size={12} color={colors.greenDark} /> Verified Reports <Text style={{ fontWeight: "800" }}>{c.reporterVerifiedReports}</Text>
            </Text>
          </View>
        </Card>

        <View style={{ flexDirection: "row", gap: 12 }}>
          <Card style={{ flex: 1 }}>
            <Text style={styles.smallHeading}>Location</Text>
            {c.coordinates ? (
              <LiveMap
                style={styles.mapThumb}
                interactive={false}
                following={false}
                focusPoint={c.coordinates}
                markers={officerCaseMarkers([c])}
                userFix={officerFix}
              />
            ) : (
              <View style={[styles.mapThumb, styles.mapThumbEmpty]}>
                <Text style={styles.smallMuted}>No GPS position</Text>
              </View>
            )}
            {c.coordinates && (
              <Pressable
                onPress={() => router.push({ pathname: "/officer/map", params: { caseId: c.id } })}
                style={{ marginTop: 8 }}
              >
                <Text style={styles.viewOnMap}>
                  View on Map <Ionicons name="arrow-forward" size={11} />
                </Text>
              </Pressable>
            )}
          </Card>
          <Card style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={styles.smallHeading}>Evidence</Text>
              <Text style={styles.smallMuted}>{c.photoCount} photos</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
              {c.images.slice(0, 4).map((uri, i) => (
                <Image key={i} source={{ uri }} style={styles.evidenceThumb} />
              ))}
            </View>
          </Card>
        </View>

        <View style={{ flexDirection: "row", gap: 12 }}>
          <Card style={{ flex: 1 }}>
            <Text style={styles.smallHeading}>System Checks</Text>
            {systemChecks({ coordinates: detail.coordinates, plateSource: detail.plateSource }).map((check) => (
              <Text key={check.label} style={styles.checkLine}>
                <Ionicons
                  name={check.state === "ok" ? "checkmark-circle" : check.state === "info" ? "information-circle" : "remove-circle"}
                  size={13}
                  color={check.state === "ok" ? colors.greenDark : colors.textLight}
                />{" "}
                {check.label}
              </Text>
            ))}
          </Card>
          <Card style={{ flex: 1 }}>
            <Text style={styles.smallHeading}>Reporter Notes</Text>
            <Text style={styles.notesText}>{c.notes ?? "No additional notes provided."}</Text>
          </Card>
        </View>
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
        {error && (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle" size={15} color="#B3261E" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
        <GreenButton
          label={CASE_ACTION_LABEL[action]}
          icon={action === "ACCEPT" ? "checkmark-circle" : undefined}
          disabled={action === "TAKEN"}
          onPress={handlePrimary}
        />
        {deskAllowed && (
          <>
            <GreenButton
              label="Reject Report"
              variant="outline"
              style={{ marginTop: 10 }}
              onPress={() => {
                setDialogError(null);
                setDecision("REPORT_REJECTED");
              }}
            />
            <Pressable
              style={{ alignItems: "center", marginTop: 12 }}
              onPress={() => {
                setDialogError(null);
                setDecision("DUPLICATE");
              }}
            >
              <Text style={{ color: colors.greenDark, fontWeight: "700", fontSize: 13 }}>Mark as Duplicate</Text>
            </Pressable>
          </>
        )}
      </View>

      <ConfirmDialog
        visible={decision !== null}
        title={decision ? DESK_CONFIRM[decision].title : ""}
        message={decision ? DESK_CONFIRM[decision].message : ""}
        confirmLabel={decision ? DESK_CONFIRM[decision].confirm : ""}
        destructive
        error={dialogError}
        onConfirm={confirmDecision}
        onCancel={() => setDecision(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  notFound: { alignItems: "center", padding: 32, gap: 8 },
  notFoundText: { color: colors.textSecondary, fontSize: 14 },
  idText: { marginLeft: "auto", fontWeight: "800", fontSize: 15 },
  metaGrid: { flexDirection: "row", marginTop: 14, borderTopWidth: 1, borderTopColor: colors.borderLight, paddingTop: 12, gap: 10 },
  metaCell: { flex: 1, gap: 2 },
  metaLabel: { fontSize: 10.5, color: colors.textLight },
  metaValue: { fontSize: 12, fontWeight: "700" },
  vehicleImg: { width: 90, height: 90, borderRadius: radius.photo },
  plate: { fontSize: 20, fontWeight: "800" },
  fieldLabel: { fontSize: 10.5, color: colors.textLight, marginTop: 6 },
  fieldValue: { fontSize: 13, fontWeight: "700" },
  trustedBadge: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 },
  trustedLabel: { fontSize: 11, fontWeight: "700", color: colors.greenDark },
  reporterAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.purpleLight, alignItems: "center", justifyContent: "center" },
  reporterInitials: { fontWeight: "800", color: colors.purple },
  reporterStat: { fontSize: 11.5, color: colors.textSecondary },
  smallHeading: { fontSize: 13.5, fontWeight: "800" },
  smallMuted: { fontSize: 11, color: colors.textLight },
  mapThumb: { height: 80, borderRadius: 10, marginTop: 8 },
  mapThumbEmpty: { backgroundColor: "#EAF0EC", alignItems: "center", justifyContent: "center" },
  viewOnMap: { color: colors.greenDark, fontWeight: "700", fontSize: 11.5 },
  evidenceThumb: { width: 44, height: 44, borderRadius: 8 },
  checkLine: { fontSize: 11.5, color: colors.textSecondary, marginTop: 6 },
  notesText: { fontSize: 12, color: colors.textSecondary, marginTop: 8, lineHeight: 16 },
  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 12, backgroundColor: colors.background },
  errorBanner: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.redLight, borderRadius: 10, padding: 10, marginBottom: 10 },
  errorText: { flex: 1, fontSize: 12.5, color: "#B3261E", fontWeight: "600" },
});
