import React from "react";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../../src/constants/colors";
import { radius } from "../../../src/constants/spacing";
import { BackHeader } from "../../../src/components/Header";
import { ReportStepper } from "../../../src/components/ReportStepper";
import { GreenButton } from "../../../src/components/GreenButton";
import { useReportDraft } from "../../../src/context/ReportContext";
import { VIOLATION_TYPES } from "../../../src/data/types";

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  "no-parking": "ban",
  sidewalk: "walk",
  crosswalk: "footsteps",
  disabled: "accessibility",
  "fire-lane": "flame",
  "bus-stop": "bus",
  "blocking-traffic": "swap-horizontal",
  "loading-zone": "cube",
  "time-restriction": "time",
  other: "ellipsis-horizontal-circle",
};

export default function SelectViolation() {
  const router = useRouter();
  const { draft, setViolation } = useReportDraft();

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <BackHeader title="Report a Parking Violation" onBack={() => router.back()} />
      <ReportStepper activeStep={2} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 140 }}>
        <View style={styles.grid}>
          {VIOLATION_TYPES.map((v) => {
            const selected = draft.violation === v.id;
            return (
              <Pressable
                key={v.id}
                style={[styles.cell, selected && styles.cellSelected]}
                onPress={() => setViolation(v.id)}
              >
                <Ionicons name={ICONS[v.id]} size={22} color={selected ? colors.greenDark : colors.textSecondary} />
                <Text style={[styles.cellTitle, selected && { color: colors.greenDark }]}>{v.label}</Text>
                <Text style={styles.cellNote} numberOfLines={2}>
                  {v.note}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.helpPanel}>
          <Ionicons name="information-circle" size={16} color={colors.textSecondary} />
          <Text style={styles.helpText}>
            Not sure? Select "Other" and add a note on the next step.
          </Text>
        </View>
      </ScrollView>
      <View style={styles.bottomBar}>
        <GreenButton label="Continue" disabled={!draft.violation} onPress={() => router.push("/user/report/add-details")} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  cell: {
    width: "47%",
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: 14,
    gap: 6,
  },
  cellSelected: { borderColor: colors.green, backgroundColor: colors.greenLight },
  cellTitle: { fontWeight: "700", fontSize: 14, color: colors.textPrimary },
  cellNote: { fontSize: 11.5, color: colors.textSecondary, lineHeight: 15 },
  helpPanel: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    marginTop: 16,
    padding: 14,
    borderRadius: radius.card,
    backgroundColor: colors.backgroundSunk,
  },
  helpText: { flex: 1, fontSize: 12.5, color: colors.textSecondary, lineHeight: 17 },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 20,
    backgroundColor: colors.background,
  },
});
