import React, { useState } from "react";
import { View, Text, ScrollView, Image, Pressable, TextInput, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { radius } from "../../src/constants/spacing";
import { BackHeader } from "../../src/components/Header";
import { GreenButton } from "../../src/components/GreenButton";
import { useApp } from "../../src/context/AppContext";
import { CLOSE_WITHOUT_CHARGE_REASONS } from "../../src/data/types";

const REASON_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  moved: "car",
  rejected: "close-circle",
  permit: "pricetag",
  duplicate: "copy",
  other: "ellipsis-horizontal-circle",
};

export default function InspectionResult() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { officerCases, completeInspection, updateOfficerDraft, officerDraft } = useApp();
  const c = officerCases.find((x) => x.id === id);
  const [selection, setSelection] = useState<string>("charge");
  const [notes, setNotes] = useState("");

  if (!c) return null;

  const handleSubmit = () => {
    updateOfficerDraft({ result: selection, notes });
    completeInspection(c.id, {
      outcome: selection === "charge" ? "charge" : "closed",
      reasonId: selection !== "charge" ? selection : undefined,
      chargeAmount: 60,
      notes,
    });
    router.replace({ pathname: "/officer/inspection-completed", params: { id: c.id, outcome: selection === "charge" ? "charge" : "closed" } });
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <BackHeader
        title="Inspection Result"
        subtitle="Choose the outcome of your on-site inspection"
        onBack={() => router.push({ pathname: "/officer/inspection", params: { id: c.id } })}
      />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 150, gap: 16 }}>
        <View style={styles.summaryCard}>
          <Image source={{ uri: c.images[0] }} style={styles.summaryImg} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.summaryLocation}>
              <Ionicons name="location" size={13} color={colors.greenDark} /> {c.location}
            </Text>
            <Text style={styles.summaryMeta}>Report ID #{c.reportId}</Text>
            <Text style={styles.summaryMeta}>Today, {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
            <Text style={styles.summaryFieldLabel}>Vehicle</Text>
            <View style={styles.plateChip}>
              <Text style={styles.plateChipLabel}>{c.plate}</Text>
            </View>
            <Text style={styles.summaryFieldLabel}>Reported violation</Text>
            <Text style={styles.summaryFieldValue}>{c.violation}</Text>
          </View>
        </View>

        <Text style={styles.eyebrow}>ENFORCEMENT ACTION</Text>
        <Pressable
          style={[styles.chargeOption, selection === "charge" && styles.chargeOptionSelected]}
          onPress={() => setSelection("charge")}
        >
          <Ionicons name="document-text" size={22} color="#06210F" />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.chargeTitle}>Issue parking charge</Text>
            <Text style={styles.chargeBody}>The violation is confirmed. Issue a parking charge.</Text>
          </View>
          <Ionicons name={selection === "charge" ? "checkmark-circle" : "ellipse-outline"} size={22} color="#06210F" />
        </Pressable>

        <Text style={styles.eyebrow}>CLOSE WITHOUT CHARGE</Text>
        <View style={styles.closeCard}>
          {CLOSE_WITHOUT_CHARGE_REASONS.map((r, i) => (
            <Pressable
              key={r.id}
              style={[styles.reasonRow, i < CLOSE_WITHOUT_CHARGE_REASONS.length - 1 && styles.reasonRowDivider]}
              onPress={() => setSelection(r.id)}
            >
              <Ionicons name={REASON_ICONS[r.id]} size={18} color={colors.textSecondary} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.reasonTitle}>{r.label}</Text>
                <Text style={styles.reasonBody}>{r.note}</Text>
              </View>
              <Ionicons name={selection === r.id ? "radio-button-on" : "radio-button-off"} size={20} color={selection === r.id ? colors.greenDark : colors.border} />
            </Pressable>
          ))}
        </View>

        <View>
          <Text style={styles.notesLabel}>Additional notes (optional)</Text>
          <TextInput
            style={styles.notesInput}
            multiline
            numberOfLines={4}
            maxLength={500}
            placeholder="Add any additional notes about this inspection..."
            placeholderTextColor={colors.textLight}
            value={notes}
            onChangeText={setNotes}
          />
          <Text style={styles.charCount}>{notes.length} / 500</Text>
        </View>
      </ScrollView>
      <View style={styles.bottomBar}>
        <GreenButton label="Submit result" icon="checkmark-circle" onPress={handleSubmit} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  summaryCard: { flexDirection: "row", borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 14 },
  summaryImg: { width: 90, height: 90, borderRadius: radius.photo },
  summaryLocation: { fontWeight: "800", fontSize: 14.5 },
  summaryMeta: { fontSize: 11.5, color: colors.textSecondary, marginTop: 2 },
  summaryFieldLabel: { fontSize: 10.5, color: colors.textLight, marginTop: 8 },
  summaryFieldValue: { fontSize: 12.5, fontWeight: "700" },
  plateChip: { backgroundColor: colors.green, borderRadius: radius.chip, paddingHorizontal: 10, paddingVertical: 3, alignSelf: "flex-start", marginTop: 2 },
  plateChipLabel: { color: "#06210F", fontWeight: "800", fontSize: 12 },
  eyebrow: { fontSize: 11.5, fontWeight: "800", color: colors.textSecondary, letterSpacing: 0.4 },
  chargeOption: { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.card, padding: 16 },
  chargeOptionSelected: { backgroundColor: colors.green, borderColor: colors.green },
  chargeTitle: { fontWeight: "800", fontSize: 14.5, color: "#06210F" },
  chargeBody: { fontSize: 11.5, color: "#0B3D22", marginTop: 2 },
  closeCard: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.card },
  reasonRow: { flexDirection: "row", alignItems: "center", padding: 14 },
  reasonRowDivider: { borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  reasonTitle: { fontWeight: "700", fontSize: 13.5 },
  reasonBody: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  notesLabel: { fontWeight: "800", fontSize: 13.5, marginBottom: 8 },
  notesInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 14, minHeight: 90, fontSize: 13.5, textAlignVertical: "top" },
  charCount: { textAlign: "right", fontSize: 11, color: colors.textLight, marginTop: 4 },
  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 20, backgroundColor: colors.background },
});
