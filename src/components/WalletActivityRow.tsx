import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../constants/colors";
import { activityDateLabel, WalletActivityItem } from "../presentation/walletViews";

const ACTIVITY_ICON = {
  REWARD_AVAILABLE: "checkmark-circle",
  REWARD_PENDING: "time",
  REWARD_CANCELLED: "remove-circle-outline",
  WITHDRAWAL_REQUESTED: "hourglass-outline",
  WITHDRAWAL_PAID: "business",
  OPENING_BALANCE: "wallet-outline",
} as const;

const TONE_COLOR = { positive: colors.greenDark, negative: colors.textPrimary, pending: "#B47A00", neutral: colors.textSecondary };

/** One wallet ledger activity line (Earnings "Recent activity" and Transaction history). Informational only. */
export function WalletActivityRow({ row }: { row: WalletActivityItem }) {
  const tone = TONE_COLOR[row.tone];
  return (
    <View style={styles.row}>
      <Ionicons name={ACTIVITY_ICON[row.kind]} size={20} color={tone} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={styles.title}>{row.title}</Text>
        <Text style={styles.subtitle}>{row.subtitle}</Text>
        <Text style={styles.date}>{activityDateLabel(row)}</Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={{ fontWeight: "800", color: tone }}>{row.amountText}</Text>
        <Text style={{ fontSize: 10.5, color: tone, marginTop: 2 }}>{row.statusText}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: colors.borderLight, paddingVertical: 12 },
  title: { fontWeight: "700", fontSize: 13.5 },
  subtitle: { fontSize: 11.5, color: colors.textSecondary, marginTop: 2 },
  date: { fontSize: 10.5, color: colors.textLight, marginTop: 2 },
});
