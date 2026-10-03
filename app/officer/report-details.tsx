import React from "react";
import { View, Text, ScrollView, Image, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { radius, shadow } from "../../src/constants/spacing";
import { BackHeader } from "../../src/components/Header";
import { GreenButton } from "../../src/components/GreenButton";
import { Card } from "../../src/components/Card";
import { StatusChip } from "../../src/components/StatusChip";
import { useApp } from "../../src/context/AppContext";

export default function ReportDetails() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { officerCases, acceptCase } = useApp();
  const c = officerCases.find((x) => x.id === id);

  if (!c) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <BackHeader title="Report Details" onBack={() => router.back()} />
        <Text style={{ padding: 20, color: colors.textSecondary }}>Case not found.</Text>
      </SafeAreaView>
    );
  }

  const handleAccept = () => {
    acceptCase(c.id);
    router.push({ pathname: "/officer/en-route", params: { id: c.id } });
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <BackHeader title="Report Details" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 150, gap: 14 }}>
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
              <Text style={styles.metaValue}>{c.reportedAgo}</Text>
            </View>
            <View style={styles.metaCell}>
              <Ionicons name="navigate-outline" size={15} color={colors.textSecondary} />
              <Text style={styles.metaValue}>{Math.round(c.distance * 1000)} m away</Text>
            </View>
            <View style={styles.metaCell}>
              <Ionicons name="location-outline" size={15} color={colors.textSecondary} />
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
              <Text style={styles.fieldValue}>{c.vehicle}</Text>
              <Text style={styles.fieldLabel}>Reported Violation</Text>
              <Text style={styles.fieldValue}>{c.violation}</Text>
              <Text style={styles.fieldLabel}>Reporter Reliability</Text>
              <Text style={[styles.fieldValue, { color: colors.greenDark }]}>{c.reporterReliability}</Text>
              <View style={styles.trustedBadge}>
                <Ionicons name="shield-checkmark" size={12} color={colors.greenDark} />
                <Text style={styles.trustedLabel}>Trusted Reporter</Text>
              </View>
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
            <Ionicons name="chevron-forward" size={16} color={colors.textLight} />
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
            <View style={styles.mapThumb}>
              <View style={styles.mapDot} />
            </View>
            <Pressable onPress={() => router.push("/officer/map")} style={{ marginTop: 8 }}>
              <Text style={styles.viewOnMap}>
                View on Map <Ionicons name="arrow-forward" size={11} />
              </Text>
            </Pressable>
          </Card>
          <Card style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={styles.smallHeading}>Evidence</Text>
              <Text style={styles.smallMuted}>{c.images.length} photos</Text>
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
            {["GPS matched", "Timestamp valid", "License plate detected", "Duplicate check: no match"].map((t) => (
              <Text key={t} style={styles.checkLine}>
                <Ionicons name="checkmark-circle" size={13} color={colors.greenDark} /> {t}
              </Text>
            ))}
          </Card>
          <Card style={{ flex: 1 }}>
            <Text style={styles.smallHeading}>Reporter Notes</Text>
            <Text style={styles.notesText}>{c.notes ?? "No additional notes provided."}</Text>
          </Card>
        </View>
      </ScrollView>
      <View style={styles.bottomBar}>
        <GreenButton label="Accept Case" icon="checkmark-circle" onPress={handleAccept} />
        <GreenButton label="Reject Report" variant="outline" style={{ marginTop: 10 }} />
        <Pressable style={{ alignItems: "center", marginTop: 12 }}>
          <Text style={{ color: colors.greenDark, fontWeight: "700", fontSize: 13 }}>Mark as Duplicate</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
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
  mapThumb: { height: 60, backgroundColor: "#EAF0EC", borderRadius: 10, marginTop: 8, alignItems: "center", justifyContent: "center" },
  mapDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.blue },
  viewOnMap: { color: colors.greenDark, fontWeight: "700", fontSize: 11.5 },
  evidenceThumb: { width: 44, height: 44, borderRadius: 8 },
  checkLine: { fontSize: 11.5, color: colors.textSecondary, marginTop: 6 },
  notesText: { fontSize: 12, color: colors.textSecondary, marginTop: 8, lineHeight: 16 },
  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 20, backgroundColor: colors.background },
});
