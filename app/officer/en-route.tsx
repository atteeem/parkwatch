import React from "react";
import { View, Text, ScrollView, Image, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { radius, shadow } from "../../src/constants/spacing";
import { GreenButton } from "../../src/components/GreenButton";
import { StatusChip } from "../../src/components/StatusChip";
import { useApp } from "../../src/context/AppContext";

export default function EnRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { officerCases, setCaseStatus, startInspectionDraft } = useApp();
  const c = officerCases.find((x) => x.id === id);

  if (!c) return null;

  const handleArrived = () => {
    setCaseStatus(c.id, "inspection");
    startInspectionDraft(c.id);
    router.push({ pathname: "/officer/inspection", params: { id: c.id } });
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>En Route</Text>
        <View style={styles.onDutyChip}>
          <View style={styles.onDutyDot} />
          <Text style={styles.onDutyLabel}>On Duty</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 20 }}>
        <Pressable
          style={styles.caseCard}
          onPress={() => router.push({ pathname: "/officer/report-details", params: { id: c.id } })}
        >
          <Image source={{ uri: c.images[0] }} style={styles.caseImg} />
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
            <View style={styles.openMapsBtn}>
              <Text style={styles.openMapsLabel}>Open in Maps</Text>
              <Ionicons name="open-outline" size={13} color="#fff" />
            </View>
          </View>
          <Text style={styles.navAddress}>{c.location}</Text>

          <View style={styles.navMap}>
            <View style={styles.routeLine} />
            <View style={styles.destPin}>
              <Ionicons name="location" size={16} color="#fff" />
            </View>
            <View style={styles.meDotBig} />
          </View>

          <View style={styles.navBottomBar}>
            <View style={{ alignItems: "center" }}>
              <Text style={styles.navBottomLabel}>ETA</Text>
              <Text style={styles.navBottomValue}>2 min</Text>
            </View>
            <View style={{ alignItems: "center" }}>
              <Text style={styles.navBottomLabel}>Distance</Text>
              <Text style={styles.navBottomValue}>{Math.round(c.distance * 1000)} m</Text>
            </View>
            <View style={{ alignItems: "center" }}>
              <Text style={styles.navBottomLabel}>Traffic</Text>
              <Text style={styles.navBottomValue}>Light</Text>
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
            <Pressable onPress={() => router.push({ pathname: "/officer/report-details", params: { id: c.id } })}>
              <Text style={styles.viewDetails}>View Details</Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {c.images.slice(0, 4).map((uri, i) => (
              <Image key={i} source={{ uri }} style={styles.originalThumb} />
            ))}
          </View>
        </View>

        <GreenButton label="Start On-site Inspection" icon="clipboard" onPress={handleArrived} trailingIcon={undefined as any} />
        <Text style={styles.subCaption}>I have arrived at the location</Text>

        <GreenButton label="Vehicle moved / not found" variant="destructive" trailingIcon={undefined as any} icon="car" />
        <Text style={styles.subCaption}>The vehicle is no longer here</Text>

        <GreenButton label="Release Case" variant="gray" trailingIcon={undefined as any} icon="close-circle" />
        <Text style={styles.subCaption}>Close and return case to queue</Text>
      </ScrollView>
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
  navMap: { height: 220, backgroundColor: "#1B1D18", position: "relative" },
  routeLine: { position: "absolute", width: 3, height: 120, backgroundColor: colors.blue, top: 40, left: 90, transform: [{ rotate: "20deg" }] },
  destPin: { position: "absolute", top: 30, left: 100, width: 26, height: 26, borderRadius: 13, backgroundColor: colors.red, alignItems: "center", justifyContent: "center" },
  meDotBig: { position: "absolute", bottom: 30, left: 80, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.blue, borderWidth: 5, borderColor: "rgba(52,120,229,0.3)" },
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
