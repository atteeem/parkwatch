import React, { useReducer, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors } from "../../src/constants/colors";
import { typography } from "../../src/constants/typography";
import { radius, shadow, BOTTOM_NAV_HEIGHT } from "../../src/constants/spacing";
import { UserBottomNav } from "../../src/components/UserBottomNav";
import { LiveMap } from "../../src/components/map/LiveMap";
import { FollowLocationButton, LocationNotice } from "../../src/components/map/MapControls";
import { usePagedList, useApp } from "../../src/context/AppContext";
import { UserReportStatus } from "../../src/data/types";
import { useForegroundLocation } from "../../src/location/useForegroundLocation";
import { citizenReportMarkers, followReducer, INITIAL_FOLLOW_STATE } from "../../src/map/mapLogic";
import { reportStatusCounts } from "../../src/presentation/citizenViews";

const FILTERS: { key: "all" | UserReportStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "under-review", label: "Under Review" },
  { key: "verified", label: "Verified" },
  { key: "rejected", label: "Rejected" },
];

// CIT-09: live map. Foreground location only while this screen is focused
// (the shared watch is released when it loses focus).
export default function UserMap() {
  const router = useRouter();
  const { citizenSummary } = useApp();
  // Markers: the citizen's most recent reports (loaded pages); counts: all reports (server).
  const recent = usePagedList({ kind: "citizenReports", tab: "all" });
  const userReports = recent.items;
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const location = useForegroundLocation({ watch: true, autoRequest: true });
  const [follow, dispatchFollow] = useReducer(followReducer, INITIAL_FOLLOW_STATE);
  const [recenterToken, setRecenterToken] = useState(0);

  const markers = citizenReportMarkers(userReports, filter);
  const counts = citizenSummary;
  const onMap = citizenReportMarkers(userReports, "all").length;
  const hasPosition = location.permission === "granted" && !!location.fix;

  const recenter = () => {
    dispatchFollow({ type: "RECENTER" });
    setRecenterToken((t) => t + 1);
    void location.refreshLocation();
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerRow}>
        <View>
          <Text style={typography.screenTitle}>Map</Text>
          <Text style={typography.screenSubtitle}>View your reports on the map</Text>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }} style={{ flexGrow: 0, marginVertical: 12 }}>
        {/* Section label, not a button: the pills next to it are the filters. */}
        <View style={styles.filterCaption}>
          <Ionicons name="options" size={14} color={colors.textSecondary} />
          <Text style={styles.filterCaptionLabel}>Show</Text>
        </View>
        {FILTERS.map((f) => (
          <Pressable key={f.key} onPress={() => setFilter(f.key)} style={[styles.filterPill, filter === f.key && styles.filterPillActive]}>
            <Text style={[styles.filterLabel, filter === f.key && styles.filterLabelActive]}>{f.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.mapWrap}>
        <LiveMap
          style={StyleSheet.absoluteFill}
          markers={markers}
          userFix={location.permission === "granted" ? location.fix : undefined}
          following={follow.following && hasPosition}
          onUserGesture={() => dispatchFollow({ type: "USER_GESTURE" })}
          recenterToken={recenterToken}
          onMarkerPress={(id) => router.push({ pathname: "/user/report/report-overview", params: { id } })}
        />
        <View style={styles.noticeWrap} pointerEvents="box-none">
          <LocationNotice
            permission={location.permission}
            error={location.error}
            onRequest={() => void location.requestPermission()}
            onRetry={() => void location.refreshLocation()}
          />
        </View>
        <View style={styles.recenterWrap}>
          <FollowLocationButton following={follow.following && hasPosition} disabled={!hasPosition} onPress={recenter} />
        </View>
      </View>

      <View style={styles.summaryCard}>
        <Ionicons name="map" size={20} color={colors.greenDark} />
        <View style={{ marginLeft: 10, flex: 1 }}>
          <Text style={styles.summaryTitle}>{onMap} Reports on Map</Text>
          <Text style={styles.summarySub}>
            {counts.verified} Verified {"•"} {counts.underReview} Under Review {"•"} {counts.rejected} Rejected
          </Text>
          {location.fix?.accuracyMeters !== undefined && location.permission === "granted" ? (
            <Text style={styles.summarySub}>Your position: accurate to about {Math.round(location.fix.accuracyMeters)} m</Text>
          ) : null}
        </View>
      </View>

      <UserBottomNav />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingHorizontal: 20, paddingTop: 4 },
  filterCaption: { flexDirection: "row", alignItems: "center", gap: 4, paddingRight: 2 },
  filterCaptionLabel: { fontSize: 13, fontWeight: "700", color: colors.textSecondary },
  filterPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.chip,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  filterPillActive: { backgroundColor: colors.greenLight, borderColor: colors.green },
  filterLabel: { fontSize: 12.5, fontWeight: "700", color: colors.textPrimary },
  filterLabelActive: { color: colors.greenDark },
  mapWrap: {
    flex: 1,
    marginHorizontal: 20,
    borderRadius: radius.cardLg,
    backgroundColor: "#E7EDE8",
    overflow: "hidden",
    marginBottom: 12,
  },
  noticeWrap: { position: "absolute", left: 10, right: 10, top: 10 },
  recenterWrap: { position: "absolute", right: 14, bottom: 14 },
  summaryCard: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 20,
    marginBottom: BOTTOM_NAV_HEIGHT + 10,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: 14,
    ...shadow.prominent,
  },
  summaryTitle: { fontWeight: "800", fontSize: 14.5 },
  summarySub: { fontSize: 11.5, color: colors.textSecondary, marginTop: 2 },
});
