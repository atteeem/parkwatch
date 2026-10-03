import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, Image, Pressable, TextInput, StyleSheet } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { radius } from "../../src/constants/spacing";
import { BackHeader } from "../../src/components/Header";
import { GreenButton } from "../../src/components/GreenButton";
import { useApp } from "../../src/context/AppContext";
import { CLOSE_WITHOUT_CHARGE_REASONS } from "../../src/data/types";
import { describeDomainError } from "../../src/presentation/errors";
import { createSubmitGuard } from "../../src/presentation/submitGuard";
import { primaryCaseAction } from "../../src/presentation/officerViews";
import { RESULT_SELECTION_TO_OUTCOME } from "../../src/presentation/viewModels";
import { showCompletedCase } from "../../src/navigation/officerNavigation";

const REASON_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  moved: "car",
  rejected: "close-circle",
  permit: "pricetag",
  duplicate: "copy",
  other: "ellipsis-horizontal-circle",
};

// OFF-08. One outcome (single select), optional notes. Consequences (charge
// amount, citizen status, reward) are decided centrally by the domain.
export default function InspectionResult() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getCase, officerId, getInspection, completeCase } = useApp();
  const c = getCase(id);
  const inspection = c ? getInspection(c.id) : undefined;
  const [selection, setSelection] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const guard = useMemo(() => createSubmitGuard(), []);
  const goBack = () => (router.canGoBack() ? router.back() : router.replace({ pathname: "/officer/inspection", params: { id } }));

  if (!c || !inspection) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <BackHeader title="Inspection Result" onBack={goBack} />
        <View style={styles.stateBox}>
          <Text style={styles.stateText}>This case could not be found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const action = primaryCaseAction(c, officerId);
  if (action !== "CONTINUE_INSPECTION" || !inspection.exists) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <BackHeader title="Inspection Result" onBack={goBack} />
        <View style={styles.stateBox}>
          <Text style={styles.stateText}>
            {action === "VIEW_RESULT" ? "This case is already closed." : "This case is not in an inspection you can complete."}
          </Text>
          {action === "VIEW_RESULT" && (
            <GreenButton
              label="View Result"
              small
              style={{ marginTop: 16 }}
              onPress={() => showCompletedCase(router, c.id)}
            />
          )}
        </View>
      </SafeAreaView>
    );
  }

  const chargeAllowed = inspection.readyForCharge;

  const handleSubmit = () => {
    if (!selection) return;
    const code = RESULT_SELECTION_TO_OUTCOME[selection];
    if (!code) return;
    setError(null);
    guard.run(() => completeCase(c.id, code, notes), {
      onSuccess: () => showCompletedCase(router, c.id),
      // Stay here; the selection and notes are kept for a retry.
      onError: (e) => setError(describeDomainError(e).message),
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <BackHeader title="Inspection Result" subtitle="Choose the outcome of your on-site inspection" onBack={goBack} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 150 + insets.bottom, gap: 16 }}>
        <View style={styles.summaryCard}>
          <Image source={{ uri: c.images[0] }} style={styles.summaryImg} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.summaryLocation}>
              <Ionicons name="location" size={13} color={colors.greenDark} /> {c.location}
            </Text>
            <Text style={styles.summaryMeta}>Report ID #{c.reportId}</Text>
            <Text style={styles.summaryMeta}>Reported {c.reportedAgo}</Text>
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
          style={[styles.chargeOption, selection === "charge" && styles.chargeOptionSelected, !chargeAllowed && styles.chargeOptionDisabled]}
          disabled={!chargeAllowed}
          accessibilityRole="radio"
          accessibilityState={{ checked: selection === "charge", disabled: !chargeAllowed }}
          onPress={() => setSelection("charge")}
        >
          <Ionicons name="document-text" size={22} color="#06210F" />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.chargeTitle}>Issue parking charge</Text>
            <Text style={styles.chargeBody}>The violation is confirmed. Issue a parking charge.</Text>
          </View>
          <Ionicons name={selection === "charge" ? "checkmark-circle" : "ellipse-outline"} size={22} color="#06210F" />
        </Pressable>
        {!chargeAllowed && (
          <Text style={styles.chargeHint}>
            Confirm all four checks and take all four officer photos to issue a parking charge ({inspection.checklistConfirmed}/4 checks,{" "}
            {inspection.photosCaptured}/4 photos).
          </Text>
        )}

        <Text style={styles.eyebrow}>CLOSE WITHOUT CHARGE</Text>
        <View style={styles.closeCard}>
          {CLOSE_WITHOUT_CHARGE_REASONS.map((r, i) => (
            <Pressable
              key={r.id}
              style={[styles.reasonRow, i < CLOSE_WITHOUT_CHARGE_REASONS.length - 1 && styles.reasonRowDivider]}
              accessibilityRole="radio"
              accessibilityState={{ checked: selection === r.id }}
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
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
        {error && (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle" size={15} color="#B3261E" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
        <GreenButton label="Submit result" icon="checkmark-circle" disabled={!selection} onPress={handleSubmit} />
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
  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 12, backgroundColor: colors.background },
  chargeOptionDisabled: { opacity: 0.5 },
  chargeHint: { fontSize: 11.5, color: "#8A6300", marginTop: -8 },
  stateBox: { alignItems: "center", padding: 32 },
  stateText: { color: colors.textSecondary, fontSize: 14, textAlign: "center" },
  errorBanner: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.redLight, borderRadius: 10, padding: 10, marginBottom: 10 },
  errorText: { flex: 1, fontSize: 12.5, color: "#B3261E", fontWeight: "600" },
});
