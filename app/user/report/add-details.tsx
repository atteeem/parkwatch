import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, TextInput, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../../src/constants/colors";
import { radius } from "../../../src/constants/spacing";
import { BackHeader } from "../../../src/components/Header";
import { ReportStepper } from "../../../src/components/ReportStepper";
import { GreenButton } from "../../../src/components/GreenButton";
import { Card } from "../../../src/components/Card";
import { useReportDraft } from "../../../src/context/ReportContext";
import { VIOLATION_TYPES } from "../../../src/data/types";

export default function AddDetails() {
  const router = useRouter();
  const { draft, setLocation, setDateTime, setNotes } = useReportDraft();
  const [address, setAddress] = useState(draft.location ?? "");
  const [notes, setLocalNotes] = useState(draft.notes ?? "");

  const violationInfo = VIOLATION_TYPES.find((v) => v.id === draft.violation);
  const now = new Date();
  const dateStr = draft.date ?? now.toLocaleDateString("en-GB").split("/").join(".");
  const timeStr = draft.time ?? now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const handleContinue = () => {
    setLocation(address || "Current location, Helsinki");
    setDateTime(dateStr, timeStr);
    setNotes(notes);
    router.push("/user/report/review");
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <BackHeader title="Report a Parking Violation" onBack={() => router.back()} />
      <ReportStepper activeStep={3} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 140, gap: 16 }}>
        <Card>
          <Text style={styles.label}>Selected issue</Text>
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.issueTitle}>{violationInfo?.label ?? "Not selected"}</Text>
              <Text style={styles.issueNote}>{violationInfo?.note}</Text>
            </View>
            <Pressable style={styles.changeBtn} onPress={() => router.push("/user/report/select-violation")}>
              <Text style={styles.changeLabel}>Change</Text>
            </Pressable>
          </View>
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Location</Text>
          <View style={styles.addressRow}>
            <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
            <TextInput
              value={address}
              onChangeText={setAddress}
              placeholder="Enter address or tap map"
              placeholderTextColor={colors.textLight}
              style={styles.addressInput}
            />
            <Ionicons name="map-outline" size={18} color={colors.textSecondary} />
          </View>
          <View style={styles.mapPreview}>
            <View style={styles.mapDot} />
          </View>
        </Card>

        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={styles.dateBox}>
            <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.dateText}>{dateStr}</Text>
          </View>
          <View style={styles.dateBox}>
            <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.dateText}>{timeStr}</Text>
          </View>
        </View>

        <View>
          <Text style={styles.sectionTitle}>Additional details (optional)</Text>
          <Text style={styles.helper}>Add any extra information that can help with verification</Text>
          <TextInput
            style={styles.textarea}
            multiline
            numberOfLines={5}
            placeholder="Describe the situation..."
            placeholderTextColor={colors.textLight}
            value={notes}
            onChangeText={setLocalNotes}
          />
        </View>

        <View>
          <Text style={styles.sectionTitle}>Attachments (optional)</Text>
          <Text style={styles.helper}>Add any extra photos or documents.</Text>
          <Pressable style={styles.attachBox}>
            <Ionicons name="image-outline" size={18} color={colors.greenDark} />
            <Text style={styles.attachLabel}>Add photo</Text>
            <Text style={styles.attachHint}>JPG, PNG up to 10 MB</Text>
          </Pressable>
        </View>
      </ScrollView>
      <View style={styles.bottomBar}>
        <GreenButton label="Continue" onPress={handleContinue} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  label: { fontSize: 12, fontWeight: "700", color: colors.textSecondary },
  issueTitle: { fontSize: 16, fontWeight: "800", marginTop: 2 },
  issueNote: { fontSize: 12.5, color: colors.textSecondary, marginTop: 2 },
  changeBtn: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.chip, paddingHorizontal: 14, paddingVertical: 8 },
  changeLabel: { fontWeight: "700", fontSize: 12.5 },
  sectionTitle: { fontSize: 16, fontWeight: "800" },
  helper: { fontSize: 12, color: colors.textSecondary, marginTop: 2, marginBottom: 8 },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 10,
  },
  addressInput: { flex: 1, fontSize: 14, color: colors.textPrimary },
  mapPreview: {
    height: 120,
    borderRadius: radius.card,
    backgroundColor: "#EAF0EC",
    marginTop: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  mapDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: colors.blue, borderWidth: 4, borderColor: "rgba(52,120,229,0.25)" },
  dateBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  dateText: { fontWeight: "600", fontSize: 14 },
  textarea: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: 14,
    minHeight: 100,
    fontSize: 14,
    color: colors.textPrimary,
    textAlignVertical: "top",
  },
  attachBox: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.border,
    borderRadius: radius.card,
    paddingVertical: 22,
    alignItems: "center",
    gap: 4,
  },
  attachLabel: { color: colors.greenDark, fontWeight: "700", fontSize: 13.5 },
  attachHint: { color: colors.textLight, fontSize: 11.5 },
  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 20, backgroundColor: colors.background },
});
