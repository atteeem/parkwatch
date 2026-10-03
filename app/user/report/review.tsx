import React from "react";
import { View, Text, ScrollView, Image, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../../src/constants/colors";
import { radius } from "../../../src/constants/spacing";
import { BackHeader } from "../../../src/components/Header";
import { ReportStepper } from "../../../src/components/ReportStepper";
import { GreenButton } from "../../../src/components/GreenButton";
import { Card } from "../../../src/components/Card";
import { StatusChip } from "../../../src/components/StatusChip";
import { useReportDraft } from "../../../src/context/ReportContext";
import { useApp } from "../../../src/context/AppContext";
import { VIOLATION_TYPES } from "../../../src/data/types";

export default function ReviewSubmit() {
  const router = useRouter();
  const { draft, resetDraft } = useReportDraft();
  const { submitUserReport } = useApp();

  const violationInfo = VIOLATION_TYPES.find((v) => v.id === draft.violation);
  const photos = [draft.photos.front, draft.photos.side, draft.photos.rear].filter(Boolean) as string[];

  const handleSubmit = () => {
    const report = submitUserReport({
      images: photos,
      violation: draft.violation ?? "other",
      location: draft.location ?? "Current location, Helsinki",
      date: draft.date ?? "",
      time: draft.time ?? "",
      notes: draft.notes ?? "",
    });
    resetDraft();
    router.replace({ pathname: "/user/report/submitted", params: { id: report.id } });
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <BackHeader title="Report overview" onBack={() => router.back()} />
      <ReportStepper activeStep={4} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 140, gap: 14 }}>
        <Card>
          <View style={{ flexDirection: "row", gap: 14 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardLabel}>Reporter</Text>
              <Text style={styles.cardValue}>You</Text>
              <View style={styles.trustedBadge}>
                <Ionicons name="shield-checkmark" size={12} color={colors.greenDark} />
                <Text style={styles.trustedText}>Trusted Reporter</Text>
              </View>
              <Text style={styles.smallMuted}>New reporter</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardLabel}>Location</Text>
              <Text style={styles.cardValue}>{draft.location ?? "Current location"}</Text>
              <Text style={styles.smallMuted}>Helsinki, Finland</Text>
              <View style={styles.mapThumb}>
                <View style={styles.mapDot} />
              </View>
            </View>
          </View>
        </Card>

        <Card>
          <Text style={styles.cardLabel}>Vehicle</Text>
          <View style={{ flexDirection: "row", marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.plate}>Captured on site</Text>
              <Text style={styles.smallMuted}>Identified from your photos</Text>
            </View>
            {photos[0] && <Image source={{ uri: photos[0] }} style={styles.vehicleImg} />}
          </View>
        </Card>

        <Card>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardLabel}>Violation</Text>
              <Text style={styles.cardValue}>{violationInfo?.label ?? "Other"}</Text>
              <Text style={styles.smallMuted}>{violationInfo?.note}</Text>
            </View>
            <StatusChip label="High Priority" tone="red" />
          </View>
        </Card>

        <Card>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={styles.cardLabel}>Evidence</Text>
            <Text style={styles.smallMuted}>{photos.length} photos</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            {photos.slice(0, 3).map((uri, i) => (
              <Image key={i} source={{ uri }} style={styles.evidenceThumb} />
            ))}
            {photos.length > 3 && (
              <View style={[styles.evidenceThumb, styles.moreThumb]}>
                <Text style={styles.moreLabel}>+{photos.length - 3}</Text>
              </View>
            )}
          </View>
        </Card>

        <Card style={{ backgroundColor: colors.greenLight, borderColor: "#BFEBCF" }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View>
              <Text style={styles.cardLabel}>Estimated Reward</Text>
              <Text style={styles.rewardValue}>{"\u20ac5.00"}</Text>
            </View>
            <StatusChip label="Pending" tone="green" />
          </View>
          <Text style={styles.rewardHint}>
            The reward will be added to your balance after the report is verified
          </Text>
        </Card>
      </ScrollView>
      <View style={styles.bottomBar}>
        <GreenButton label="Submit Report" onPress={handleSubmit} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  cardLabel: { fontSize: 12, fontWeight: "700", color: colors.textSecondary },
  cardValue: { fontSize: 16, fontWeight: "800", marginTop: 3 },
  smallMuted: { fontSize: 11.5, color: colors.textLight, marginTop: 2 },
  trustedBadge: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  trustedText: { fontSize: 11.5, fontWeight: "700", color: colors.greenDark },
  mapThumb: { height: 54, borderRadius: 10, backgroundColor: "#EAF0EC", marginTop: 8, alignItems: "center", justifyContent: "center" },
  mapDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.blue },
  plate: { fontSize: 15, fontWeight: "700" },
  vehicleImg: { width: 70, height: 70, borderRadius: radius.photo, marginLeft: 10 },
  evidenceThumb: { width: 64, height: 64, borderRadius: 12 },
  moreThumb: { backgroundColor: colors.backgroundSunk, alignItems: "center", justifyContent: "center" },
  moreLabel: { fontWeight: "800", color: colors.textSecondary },
  rewardValue: { fontSize: 24, fontWeight: "800", color: colors.greenDark, marginTop: 4 },
  rewardHint: { fontSize: 12, color: "#0B7A38", marginTop: 10, lineHeight: 16 },
  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 20, backgroundColor: colors.background },
});
