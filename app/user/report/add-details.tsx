import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, TextInput, Image, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { colors } from "../../../src/constants/colors";
import { radius } from "../../../src/constants/spacing";
import { BackHeader } from "../../../src/components/Header";
import { ReportStepper } from "../../../src/components/ReportStepper";
import { GreenButton } from "../../../src/components/GreenButton";
import { Card } from "../../../src/components/Card";
import { useReportDraft } from "../../../src/context/ReportContext";
import { VIOLATION_TYPES } from "../../../src/data/types";
import { validateDraft } from "../../../src/domain";
import { draftIssueMessages } from "../../../src/presentation/errors";
import { draftObservedAt } from "../../../src/presentation/reportDraft";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const pad = (n: number) => String(n).padStart(2, "0");

export default function AddDetails() {
  const router = useRouter();
  const { draft, setLocation, setNotes, addAttachment, removeAttachment } = useReportDraft();
  const [showErrors, setShowErrors] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);

  const violationInfo = VIOLATION_TYPES.find((v) => v.id === draft.violationId);
  // observedAt: when the citizen saw the violation (device time; defaults to photo capture time).
  const observed = draftObservedAt(draft);
  const observedDate = observed ? new Date(observed) : undefined;
  const dateStr = observedDate
    ? `${pad(observedDate.getDate())}.${pad(observedDate.getMonth() + 1)}.${observedDate.getFullYear()}`
    : "—";
  const timeStr = observedDate ? `${pad(observedDate.getHours())}:${pad(observedDate.getMinutes())}` : "—";

  const issues = validateDraft(draft, "DETAILS");
  const messages = draftIssueMessages(issues);

  const handleContinue = () => {
    if (issues.length > 0) {
      setShowErrors(true); // stay here; nothing the user entered is cleared
      return;
    }
    router.push("/user/report/review");
  };

  const pickAttachment = async () => {
    setAttachError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if (asset.fileSize && asset.fileSize > MAX_ATTACHMENT_BYTES) {
        setAttachError("That image is larger than 10 MB.");
        return;
      }
      // Stored as LIBRARY evidence in the attachments list, never in a required photo slot.
      addAttachment(asset.uri);
    } catch {
      setAttachError("Could not open your photo library. Please try again.");
    }
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
          <View style={[styles.addressRow, showErrors && messages.location ? styles.addressRowError : null]}>
            <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
            <TextInput
              value={draft.location.address}
              onChangeText={setLocation}
              placeholder="Enter address or tap map"
              placeholderTextColor={colors.textLight}
              style={styles.addressInput}
            />
            <Ionicons name="map-outline" size={18} color={colors.textSecondary} />
          </View>
          {showErrors && messages.location ? <Text style={styles.errorText}>{messages.location}</Text> : null}
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
            value={draft.notes}
            onChangeText={setNotes}
          />
        </View>

        <View>
          <Text style={styles.sectionTitle}>Attachments (optional)</Text>
          <Text style={styles.helper}>Add extra photos from your library. They don't replace the three camera photos.</Text>
          {draft.attachments.length > 0 && (
            <View style={styles.attachRow}>
              {draft.attachments.map((a) => (
                <View key={a.id}>
                  <Image source={{ uri: a.uri }} style={styles.attachThumb} />
                  <Pressable style={styles.attachRemove} onPress={() => removeAttachment(a.id)} hitSlop={8}>
                    <Ionicons name="close" size={12} color="#fff" />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          <Pressable style={styles.attachBox} onPress={pickAttachment}>
            <Ionicons name="image-outline" size={18} color={colors.greenDark} />
            <Text style={styles.attachLabel}>Add photo</Text>
            <Text style={styles.attachHint}>JPG, PNG up to 10 MB</Text>
          </Pressable>
          {attachError ? <Text style={styles.errorText}>{attachError}</Text> : null}
        </View>
      </ScrollView>
      <View style={styles.bottomBar}>
        {showErrors && issues.length > 0 && !messages.location ? (
          <Text style={[styles.errorText, { marginBottom: 8 }]}>{Object.values(messages)[0]}</Text>
        ) : null}
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
  addressRowError: { borderColor: colors.red },
  addressInput: { flex: 1, fontSize: 14, color: colors.textPrimary },
  errorText: { color: "#B3261E", fontSize: 12, fontWeight: "600", marginTop: 6 },
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
  attachRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  attachThumb: { width: 60, height: 60, borderRadius: 10 },
  attachRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
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
