import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors } from "../constants/colors";
import { radius } from "../constants/spacing";

export type ChipTone = "green" | "greenDark" | "red" | "amber" | "blue" | "purple" | "grey";

const TONE_STYLES: Record<ChipTone, { bg: string; fg: string }> = {
  green: { bg: colors.greenLight, fg: colors.greenDark },
  greenDark: { bg: colors.green, fg: "#06210F" },
  red: { bg: colors.redLight, fg: "#B3261E" },
  amber: { bg: colors.amberLight, fg: "#8A6300" },
  blue: { bg: colors.blueLight, fg: colors.blue },
  purple: { bg: colors.purpleLight, fg: colors.purple },
  grey: { bg: colors.backgroundSunk, fg: colors.textSecondary },
};

// Central mapping from a status string to a chip tone + label, so every
// screen renders the same status consistently.
const STATUS_MAP: Record<string, { label: string; tone: ChipTone }> = {
  "under-review": { label: "Under Review", tone: "amber" },
  verified: { label: "Verified", tone: "green" },
  rejected: { label: "Rejected", tone: "red" },
  new: { label: "New", tone: "green" },
  assigned: { label: "Assigned", tone: "purple" },
  "en-route": { label: "En Route", tone: "blue" },
  "on-site": { label: "On Site", tone: "amber" },
  inspection: { label: "Inspection", tone: "purple" },
  completed: { label: "Completed", tone: "green" },
  high: { label: "High Priority", tone: "red" },
  medium: { label: "Medium", tone: "amber" },
  normal: { label: "New", tone: "blue" },
};

type Props = {
  status?: string;
  label?: string;
  tone?: ChipTone;
  small?: boolean;
};

export function StatusChip({ status, label, tone }: Props) {
  const mapped = status ? STATUS_MAP[status] : undefined;
  const finalLabel = label ?? mapped?.label ?? status ?? "";
  const finalTone: ChipTone = tone ?? mapped?.tone ?? "grey";
  const t = TONE_STYLES[finalTone];
  return (
    <View style={[styles.chip, { backgroundColor: t.bg }]}>
      <Text style={[styles.label, { color: t.fg }]}>{finalLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.chip,
    alignSelf: "flex-start",
  },
  label: {
    fontSize: 12.5,
    fontWeight: "700",
  },
});
