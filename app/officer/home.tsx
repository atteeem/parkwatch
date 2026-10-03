import React from "react";
import { View, Text, ScrollView, Pressable, Image, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { typography } from "../../src/constants/typography";
import { radius, shadow, BOTTOM_NAV_HEIGHT } from "../../src/constants/spacing";
import { OfficerBottomNav } from "../../src/components/OfficerBottomNav";
import { CaseCard } from "../../src/components/CaseCard";
import { useApp } from "../../src/context/AppContext";

export default function OfficerHome() {
  const router = useRouter();
  const { officerCases, officerNotifications } = useApp();
  const nearest = officerCases.find((c) => c.status === "new");
  const active = officerCases.filter((c) => ["assigned", "en-route", "on-site", "inspection"].includes(c.status)).slice(0, 3);
  const unread = officerNotifications.filter((n) => n.unread).length;
  const highPriorityCount = officerCases.filter((c) => c.priority === "high" && c.status === "new").length;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: BOTTOM_NAV_HEIGHT + 20 }}>
        <View style={styles.topRow}>
          <Pressable onPress={() => router.push("/officer/profile")}>
            <Image source={{ uri: "https://picsum.photos/seed/officer1/120/120" }} style={styles.avatar} />
          </Pressable>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.greeting}>Good morning,{"\n"}Officer Mikko</Text>
            <Text style={styles.greetingSub}>Here's what's happening on your shift.</Text>
          </View>
          <View style={{ alignItems: "flex-end", gap: 8 }}>
            <View style={styles.onDutyChip}>
              <View style={styles.onDutyDot} />
              <Text style={styles.onDutyLabel}>On Duty</Text>
            </View>
            <Pressable style={styles.bellBtn} onPress={() => router.push("/officer/notifications")}>
              <Ionicons name="notifications" size={18} color={colors.textPrimary} />
              {unread > 0 && (
                <View style={styles.bellBadge}>
                  <Text style={styles.bellBadgeLabel}>{unread}</Text>
                </View>
              )}
            </Pressable>
          </View>
        </View>

        <View style={styles.statsRow}>
          <Text style={styles.statChip}>
            <Ionicons name="document-text" size={13} color={colors.textSecondary} /> {officerCases.length} nearby reports
          </Text>
          <Text style={styles.statChip}>
            <Ionicons name="alert-circle" size={13} color={colors.red} /> {highPriorityCount} high priority
          </Text>
        </View>

        {nearest && (
          <Pressable
            style={styles.nearestCard}
            onPress={() => router.push({ pathname: "/officer/report-details", params: { id: nearest.id } })}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={styles.nearestEyebrow}>NEAREST NEW REPORT</Text>
              <Text style={styles.nearestDistance}>
                {nearest.distance.toFixed(1)}km away <Ionicons name="navigate" size={11} />
              </Text>
            </View>
            <View style={{ flexDirection: "row", marginTop: 10 }}>
              <Image source={{ uri: nearest.images[0] }} style={styles.nearestImg} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.nearestPlate}>{nearest.plate}</Text>
                <Text style={styles.nearestMeta}>
                  <Ionicons name="pricetag" size={12} /> {nearest.violation}
                </Text>
                <Text style={styles.nearestMeta}>
                  <Ionicons name="location" size={12} /> {nearest.location}
                </Text>
                <Text style={styles.nearestMeta}>
                  <Ionicons name="time" size={12} /> Reported {nearest.reportedAgo}
                </Text>
                <Text style={styles.nearestReliability}>
                  <Ionicons name="shield-checkmark" size={12} color={colors.greenDark} /> Reporter reliability: {nearest.reporterReliability}
                </Text>
              </View>
            </View>
            <View style={styles.viewReportBtn}>
              <Text style={styles.viewReportLabel}>View Report</Text>
              <Ionicons name="chevron-forward" size={14} color="#06210F" />
            </View>
          </Pressable>
        )}

        <View style={styles.mapSection}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={typography.sectionHeading}>Live Map</Text>
            <Pressable onPress={() => router.push("/officer/map")}>
              <Text style={styles.viewFullMap}>View full map</Text>
            </Pressable>
          </View>
          <Pressable style={styles.mapPreview} onPress={() => router.push("/officer/map")}>
            <View style={[styles.marker, { backgroundColor: colors.amber, top: 20, left: 30 }]}><Text style={styles.markerLabel}>3</Text></View>
            <View style={[styles.marker, { backgroundColor: colors.red, top: 60, left: 140 }]}><Ionicons name="alert" size={12} color="#fff" /></View>
            <View style={[styles.marker, { backgroundColor: colors.green, top: 100, left: 40 }]}><Text style={styles.markerLabel}>2</Text></View>
            <View style={[styles.marker, { backgroundColor: colors.green, top: 110, left: 210 }]}><Text style={styles.markerLabel}>4</Text></View>
            <View style={[styles.marker, { backgroundColor: colors.amber, top: 25, left: 230 }]}><Text style={styles.markerLabel}>2</Text></View>
            <View style={styles.meDot} />
          </Pressable>
          <View style={styles.legendRow}>
            <Text style={styles.legendItem}><Ionicons name="ellipse" size={9} color={colors.green} /> New reports</Text>
            <Text style={styles.legendItem}><Ionicons name="ellipse" size={9} color={colors.amber} /> Assigned cases</Text>
            <Text style={styles.legendItem}><Ionicons name="ellipse" size={9} color={colors.red} /> High Priority</Text>
          </View>
        </View>

        <View style={{ marginTop: 20 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={typography.sectionHeading}>Active Cases</Text>
            <Pressable onPress={() => router.push("/officer/cases")}>
              <Text style={styles.viewFullMap}>View All</Text>
            </Pressable>
          </View>
          <View style={{ marginTop: 10 }}>
            {active.map((c) => (
              <CaseCard key={c.id} item={c} onPress={() => router.push({ pathname: "/officer/report-details", params: { id: c.id } })} />
            ))}
          </View>
        </View>

        <View style={styles.shiftCard}>
          <Text style={styles.shiftTitle}>Shift Overview</Text>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 12 }}>
            {[
              { icon: "time", value: "18m", label: "Avg. Response Time", delta: "\u2193 5m vs yesterday" },
              { icon: "document-text", value: "22", label: "Cases Assigned", delta: "\u2191 6 vs yesterday" },
              { icon: "checkmark-done", value: "27", label: "Cases completed", delta: "\u2191 5 vs yesterday" },
            ].map((s) => (
              <View key={s.label} style={{ alignItems: "center", flex: 1 }}>
                <View style={styles.shiftIcon}>
                  <Ionicons name={s.icon as any} size={17} color={colors.greenDark} />
                </View>
                <Text style={styles.shiftValue}>{s.value}</Text>
                <Text style={styles.shiftLabel}>{s.label}</Text>
                <Text style={styles.shiftDelta}>{s.delta}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
      <OfficerBottomNav />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  topRow: { flexDirection: "row", alignItems: "flex-start" },
  avatar: { width: 52, height: 52, borderRadius: 26 },
  greeting: { fontSize: 18, fontWeight: "800", lineHeight: 22 },
  greetingSub: { fontSize: 12.5, color: colors.textSecondary, marginTop: 4 },
  onDutyChip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.greenLight, borderRadius: radius.chip, paddingHorizontal: 10, paddingVertical: 5 },
  onDutyDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.greenDark },
  onDutyLabel: { fontSize: 11, fontWeight: "700", color: colors.greenDark },
  bellBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.backgroundSunk, alignItems: "center", justifyContent: "center" },
  bellBadge: { position: "absolute", top: -3, right: -3, backgroundColor: colors.green, borderRadius: 8, minWidth: 16, height: 16, alignItems: "center", justifyContent: "center" },
  bellBadgeLabel: { fontSize: 9.5, fontWeight: "800", color: "#06210F" },
  statsRow: { flexDirection: "row", gap: 16, marginTop: 14 },
  statChip: { fontSize: 12.5, fontWeight: "600", color: colors.textSecondary },
  nearestCard: { backgroundColor: colors.amberLight, borderRadius: radius.card, padding: 14, marginTop: 16, borderWidth: 1, borderColor: "#F3DFA0" },
  nearestEyebrow: { fontSize: 10.5, fontWeight: "800", color: "#8A6300", letterSpacing: 0.4 },
  nearestDistance: { fontSize: 11.5, fontWeight: "700", color: colors.greenDark },
  nearestImg: { width: 76, height: 76, borderRadius: radius.photo },
  nearestPlate: { fontSize: 17, fontWeight: "800" },
  nearestMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 3 },
  nearestReliability: { fontSize: 11.5, fontWeight: "700", color: colors.greenDark, marginTop: 4 },
  viewReportBtn: { flexDirection: "row", gap: 4, alignSelf: "flex-end", backgroundColor: colors.green, borderRadius: radius.chip, paddingHorizontal: 14, paddingVertical: 9, marginTop: 10, alignItems: "center" },
  viewReportLabel: { fontWeight: "800", fontSize: 12.5, color: "#06210F" },
  mapSection: { marginTop: 20 },
  viewFullMap: { color: colors.greenDark, fontWeight: "700", fontSize: 13 },
  mapPreview: { height: 180, backgroundColor: "#EAF0EC", borderRadius: radius.card, marginTop: 10, overflow: "hidden" },
  marker: { position: "absolute", width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", ...shadow.card },
  markerLabel: { color: "#fff", fontWeight: "800", fontSize: 11 },
  meDot: { position: "absolute", top: 80, left: 130, width: 14, height: 14, borderRadius: 7, backgroundColor: colors.blue, borderWidth: 4, borderColor: "rgba(52,120,229,0.25)" },
  legendRow: { flexDirection: "row", gap: 14, marginTop: 10, flexWrap: "wrap" },
  legendItem: { fontSize: 11, color: colors.textSecondary, fontWeight: "600" },
  shiftCard: { marginTop: 20, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 16, ...shadow.card },
  shiftTitle: { fontSize: 16, fontWeight: "800" },
  shiftIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.greenLight, alignItems: "center", justifyContent: "center" },
  shiftValue: { fontSize: 17, fontWeight: "800", marginTop: 6 },
  shiftLabel: { fontSize: 10.5, color: colors.textSecondary, textAlign: "center", marginTop: 2 },
  shiftDelta: { fontSize: 10, color: colors.greenDark, fontWeight: "700", marginTop: 2, textAlign: "center" },
});
