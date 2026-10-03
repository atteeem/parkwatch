import React, { useReducer, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { radius, shadow, BOTTOM_NAV_HEIGHT } from "../../src/constants/spacing";
import { OfficerBottomNav } from "../../src/components/OfficerBottomNav";
import { useApp } from "../../src/context/AppContext";
import { EvidencePhoto } from "../../src/components/EvidencePhoto";
import { LiveMap } from "../../src/components/map/LiveMap";
import { FollowLocationButton, LocationNotice } from "../../src/components/map/MapControls";
import { formatDistance, straightLineDistance } from "../../src/geo/distance";
import { useForegroundLocation } from "../../src/location/useForegroundLocation";
import { followReducer, nearestNewCase, officerCaseMarkers } from "../../src/map/mapLogic";
import { filterQueue, QueueFilter, withDistances } from "../../src/presentation/officerViews";

const MAP_FILTERS: readonly QueueFilter[] = ["All", "New", "High Priority", "Assigned"];

// OFF-03: real map + officer foreground position + open-case markers.
// Opened with ?caseId= (En Route "Open in Maps") it focuses that case.
// Straight-line distance only: no routing, no ETA.
export default function OfficerLiveMap() {
  const router = useRouter();
  const { caseId } = useLocalSearchParams<{ caseId?: string }>();
  const { officerCases, officerId, getCase } = useApp();
  const focused = caseId ? getCase(caseId) : undefined;
  const focusPoint = focused?.coordinates;
  // Foreground only, while this screen is focused. No background tracking.
  const location = useForegroundLocation({ watch: true, autoRequest: true });
  const [follow, dispatchFollow] = useReducer(followReducer, { following: !focusPoint });
  const [recenterToken, setRecenterToken] = useState(0);
  const [mapFilter, setMapFilter] = useState<QueueFilter>("All");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const officerFix = location.permission === "granted" ? location.fix : undefined;
  const visible = filterQueue(withDistances(officerCases, officerFix), mapFilter, officerId);
  const nearestResult = nearestNewCase(visible, officerFix);
  // The sheet shows the focused case if one was requested, else the nearest new one.
  const sheet = focused
    ? { item: focused, distanceMeters: straightLineDistance(officerFix, focused.coordinates), title: "Selected Report" }
    : nearestResult && { ...nearestResult, title: "Nearest Report" };
  const nearest = sheet?.item;
  const openCase = (id: string) => router.push({ pathname: "/officer/report-details", params: { id } });

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerRow}>
        {caseId && router.canGoBack() && (
          <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back to case">
            <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
          </Pressable>
        )}
        <Text style={styles.title}>Live Map</Text>
        <View style={styles.onDutyChip}>
          <View style={styles.onDutyDot} />
          <Text style={styles.onDutyLabel}>On Duty</Text>
        </View>
      </View>

      <View style={styles.segmentRow}>
        <View style={[styles.segment, styles.segmentActive]}>
          <Ionicons name="map" size={15} color="#06210F" />
          <Text style={styles.segmentLabelActive}>Map</Text>
        </View>
        <Pressable style={styles.segment} onPress={() => router.replace("/officer/queue")}>
          <Ionicons name="list" size={15} color={colors.textPrimary} />
          <Text style={styles.segmentLabel}>List</Text>
        </Pressable>
      </View>

      <View style={styles.mapWrap}>
        <View style={styles.filterWrap}>
          <Pressable style={styles.filterChip} onPress={() => setFiltersOpen((o) => !o)}>
            <Ionicons name="options" size={13} color={colors.textPrimary} />
            <Text style={styles.filterChipLabel}>{mapFilter === "All" ? "Filters" : mapFilter}</Text>
            <Ionicons name={filtersOpen ? "chevron-up" : "chevron-down"} size={12} color={colors.textPrimary} />
          </Pressable>
          {filtersOpen && (
            <View style={styles.filterMenu}>
              {MAP_FILTERS.map((f) => (
                <Pressable
                  key={f}
                  style={styles.filterOption}
                  onPress={() => {
                    setMapFilter(f);
                    setFiltersOpen(false);
                  }}
                >
                  <Text style={[styles.filterOptionLabel, f === mapFilter && { color: colors.greenDark }]}>{f}</Text>
                  {f === mapFilter && <Ionicons name="checkmark" size={14} color={colors.greenDark} />}
                </Pressable>
              ))}
            </View>
          )}
          {caseId && !focused && <Text style={styles.focusMissing}>That case was not found.</Text>}
        </View>

        <LiveMap
          style={StyleSheet.absoluteFill}
          focusPoint={focusPoint}
          markers={officerCaseMarkers(visible)}
          userFix={officerFix}
          following={follow.following && !!officerFix}
          onUserGesture={() => dispatchFollow({ type: "USER_GESTURE" })}
          recenterToken={recenterToken}
          onMarkerPress={openCase}
        />
        <View style={styles.noticeWrap} pointerEvents="box-none">
          <LocationNotice
            permission={location.permission}
            error={location.error}
            onRequest={() => void location.requestPermission()}
            onRetry={() => void location.refreshLocation()}
          />
        </View>

        <View style={styles.mapControls}>
          <FollowLocationButton
            following={follow.following && !!officerFix}
            disabled={!officerFix}
            onPress={() => {
              dispatchFollow({ type: "RECENTER" });
              setRecenterToken((t) => t + 1);
              void location.refreshLocation();
            }}
          />
        </View>
      </View>

      {sheet && nearest && (
        <Pressable
          style={styles.nearestSheet}
          onPress={() => openCase(nearest.id)}
        >
          <View style={styles.sheetHandle} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={styles.sheetTitle}>{sheet.title}</Text>
            {nearest.priority === "high" && (
              <View style={styles.highChip}>
                <Text style={styles.highChipLabel}>High Priority</Text>
              </View>
            )}
          </View>
          <View style={{ flexDirection: "row", marginTop: 10, alignItems: "center" }}>
            <EvidencePhoto uri={nearest.images[0]} style={styles.sheetImg} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.sheetPlateTitle}>{nearest.violation}</Text>
              <Text style={styles.sheetMeta}>
                <Ionicons name="location" size={11} /> {nearest.location}
              </Text>
              <Text style={styles.sheetMeta}>
                <Ionicons name="time" size={11} /> Reported {nearest.reportedAgo}
              </Text>
              <Text style={styles.sheetReliability}>
                <Ionicons name="shield-checkmark" size={11} color={colors.greenDark} /> Reporter Reliability: {nearest.reporterReliability}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end", gap: 8 }}>
              {sheet.distanceMeters != null ? (
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.sheetDistance}>{formatDistance(sheet.distanceMeters)}</Text>
                  <Text style={styles.sheetMeta}>straight line</Text>
                </View>
              ) : null}
              <View style={styles.viewCaseBtn}>
                <Text style={styles.viewCaseLabel}>View Case</Text>
              </View>
            </View>
          </View>
        </Pressable>
      )}
      <OfficerBottomNav />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  headerRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", paddingHorizontal: 20, paddingTop: 6 },
  title: { fontSize: 22, fontWeight: "800" },
  backBtn: { position: "absolute", left: 16, top: 8, width: 34, height: 34, borderRadius: 17, backgroundColor: colors.backgroundSunk, alignItems: "center", justifyContent: "center" },
  onDutyChip: { position: "absolute", right: 20, top: 8, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.greenLight, borderRadius: radius.chip, paddingHorizontal: 10, paddingVertical: 5 },
  onDutyDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.greenDark },
  onDutyLabel: { fontSize: 11, fontWeight: "700", color: colors.greenDark },
  segmentRow: { flexDirection: "row", gap: 8, paddingHorizontal: 20, marginTop: 12 },
  segment: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.button, paddingVertical: 12 },
  segmentActive: { backgroundColor: colors.green, borderColor: colors.green },
  segmentLabel: { fontWeight: "700", fontSize: 14 },
  segmentLabelActive: { fontWeight: "700", fontSize: 14, color: "#06210F" },
  mapWrap: { flex: 1, marginTop: 14, backgroundColor: "#E7EDE8" },
  filterWrap: { position: "absolute", top: 14, left: 14, zIndex: 5, alignItems: "flex-start", gap: 6 },
  filterMenu: { backgroundColor: "#fff", borderRadius: 12, paddingVertical: 4, minWidth: 160, ...shadow.card },
  filterOption: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 14, paddingVertical: 9 },
  filterOptionLabel: { fontWeight: "700", fontSize: 13 },
  focusMissing: { backgroundColor: "#fff", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 12, color: colors.red, fontWeight: "600" },
  filterChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fff", borderRadius: radius.chip, paddingHorizontal: 12, paddingVertical: 8, ...shadow.card },
  filterChipLabel: { fontWeight: "700", fontSize: 12.5 },
  noticeWrap: { position: "absolute", left: 10, right: 10, top: 52 },
  mapControls: { position: "absolute", right: 14, bottom: 14, gap: 10 },
  nearestSheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, paddingBottom: BOTTOM_NAV_HEIGHT + 10, ...shadow.prominent },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginBottom: 12 },
  sheetTitle: { fontSize: 16, fontWeight: "800" },
  highChip: { backgroundColor: colors.redLight, borderRadius: radius.chip, paddingHorizontal: 10, paddingVertical: 3 },
  highChipLabel: { color: colors.red, fontWeight: "700", fontSize: 11 },
  sheetImg: { width: 60, height: 60, borderRadius: radius.photo },
  sheetPlateTitle: { fontWeight: "800", fontSize: 14.5 },
  sheetMeta: { fontSize: 11.5, color: colors.textSecondary, marginTop: 2 },
  sheetReliability: { fontSize: 11, fontWeight: "700", color: colors.greenDark, marginTop: 3 },
  sheetDistance: { fontWeight: "800", color: colors.greenDark },
  viewCaseBtn: { backgroundColor: colors.green, borderRadius: radius.chip, paddingHorizontal: 12, paddingVertical: 7 },
  viewCaseLabel: { fontWeight: "800", fontSize: 12, color: "#06210F" },
});
