import React from "react";
import { View, Text, Pressable, Image, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { radius, shadow, BOTTOM_NAV_HEIGHT } from "../../src/constants/spacing";
import { OfficerBottomNav } from "../../src/components/OfficerBottomNav";
import { useApp } from "../../src/context/AppContext";

const MARKERS = [
  { count: 1, tone: "amber", top: 30, left: 40 },
  { count: 1, tone: "green", top: 90, left: 10 },
  { tone: "red", top: 100, left: 160 },
  { count: 2, tone: "amber", top: 130, left: 220 },
  { count: 2, tone: "green", top: 160, left: 60 },
  { count: 3, tone: "green", top: 190, left: 210 },
  { tone: "red", top: 230, left: 30 },
  { count: 4, tone: "green", top: 250, left: 100 },
  { count: 2, tone: "amber", top: 300, left: 60 },
  { tone: "red", top: 300, left: 150 },
];

const TONE_COLOR: Record<string, string> = { amber: colors.amber, green: colors.green, red: colors.red };

export default function LiveMap() {
  const router = useRouter();
  const { officerCases } = useApp();
  const nearest = officerCases.find((c) => c.status === "new");

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerRow}>
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
        <Pressable style={styles.segment} onPress={() => router.push("/officer/queue")}>
          <Ionicons name="list" size={15} color={colors.textPrimary} />
          <Text style={styles.segmentLabel}>List</Text>
        </Pressable>
      </View>

      <View style={styles.mapWrap}>
        <View style={styles.filterChip}>
          <Ionicons name="options" size={13} color={colors.textPrimary} />
          <Text style={styles.filterChipLabel}>Filters</Text>
          <Ionicons name="chevron-down" size={12} color={colors.textPrimary} />
        </View>

        {MARKERS.map((m, i) => (
          <View key={i} style={[styles.marker, { top: m.top, left: m.left, backgroundColor: TONE_COLOR[m.tone] }]}>
            {m.count ? <Text style={styles.markerLabel}>{m.count}</Text> : <Ionicons name="alert" size={12} color="#fff" />}
          </View>
        ))}
        <View style={styles.meDot} />

        <View style={styles.mapControls}>
          <View style={styles.mapControlBtn}>
            <Ionicons name="locate" size={17} color={colors.textPrimary} />
          </View>
          <View style={styles.mapControlBtn}>
            <Ionicons name="navigate" size={17} color={colors.textPrimary} />
          </View>
        </View>
      </View>

      {nearest && (
        <Pressable
          style={styles.nearestSheet}
          onPress={() => router.push({ pathname: "/officer/report-details", params: { id: nearest.id } })}
        >
          <View style={styles.sheetHandle} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={styles.sheetTitle}>Nearest Report</Text>
            <View style={styles.highChip}>
              <Text style={styles.highChipLabel}>High Priority</Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", marginTop: 10, alignItems: "center" }}>
            <Image source={{ uri: nearest.images[0] }} style={styles.sheetImg} />
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
              <Text style={styles.sheetDistance}>{Math.round(nearest.distance * 1000)} m</Text>
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
  onDutyChip: { position: "absolute", right: 20, top: 8, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.greenLight, borderRadius: radius.chip, paddingHorizontal: 10, paddingVertical: 5 },
  onDutyDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.greenDark },
  onDutyLabel: { fontSize: 11, fontWeight: "700", color: colors.greenDark },
  segmentRow: { flexDirection: "row", gap: 8, paddingHorizontal: 20, marginTop: 12 },
  segment: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.button, paddingVertical: 12 },
  segmentActive: { backgroundColor: colors.green, borderColor: colors.green },
  segmentLabel: { fontWeight: "700", fontSize: 14 },
  segmentLabelActive: { fontWeight: "700", fontSize: 14, color: "#06210F" },
  mapWrap: { flex: 1, marginTop: 14, backgroundColor: "#E7EDE8" },
  filterChip: { position: "absolute", top: 14, left: 14, zIndex: 5, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fff", borderRadius: radius.chip, paddingHorizontal: 12, paddingVertical: 8, ...shadow.card },
  filterChipLabel: { fontWeight: "700", fontSize: 12.5 },
  marker: { position: "absolute", width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", ...shadow.card },
  markerLabel: { color: "#fff", fontWeight: "800", fontSize: 12 },
  meDot: { position: "absolute", top: 160, left: 130, width: 16, height: 16, borderRadius: 8, backgroundColor: colors.blue, borderWidth: 4, borderColor: "rgba(52,120,229,0.25)" },
  mapControls: { position: "absolute", right: 14, bottom: 14, gap: 10 },
  mapControlBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", ...shadow.card },
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
