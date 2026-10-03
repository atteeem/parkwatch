import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, TextInput, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { radius } from "../../src/constants/spacing";
import { Card } from "../../src/components/Card";
import { GreenButton } from "../../src/components/GreenButton";
import { useApp } from "../../src/context/AppContext";
import { MIN_WITHDRAWAL_AMOUNT_CENTS } from "../../src/domain";
import { formatEuros } from "../../src/presentation/viewModels";
import {
  checkWithdrawalInput,
  confirmWithdrawal,
  formatAmountInput,
  initialWithdrawCents,
  withdrawPresets,
} from "../../src/presentation/withdrawForm";

// Simulated withdrawal REQUEST: it reduces the available balance in the
// ledger, but no real bank transfer happens in the MVP.
export default function Withdraw() {
  const router = useRouter();
  const { walletAvailable, walletPending, validateWithdrawal, withdraw } = useApp();
  const availableCents = Math.round(walletAvailable * 100);
  const [amountText, setAmountText] = useState(() => formatAmountInput(initialWithdrawCents(availableCents)));
  const [error, setError] = useState<string | null>(null);

  const check = checkWithdrawalInput(amountText, validateWithdrawal);
  const amountCents = check.ok ? check.cents : 0;
  const shownAmount = check.ok ? formatEuros(amountCents) : "—";

  const confirm = () => {
    confirmWithdrawal(amountText, {
      validate: validateWithdrawal,
      withdraw,
      onSuccess: () => router.replace("/user/home"), // current MVP destination
      onError: setError, // refused: stay here with the reason
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/user/earnings"))} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Withdraw money</Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Card dark>
          <Text style={styles.hbLabel}>Available balance</Text>
          <Text style={styles.hbAmount}>{formatEuros(availableCents)}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="checkmark-circle" size={14} color={colors.green} />
            <Text style={styles.readyLabel}>Ready to withdraw</Text>
          </View>
          <Text style={styles.pendingLabel}>{formatEuros(Math.round(walletPending * 100))} pending verification</Text>
        </Card>

        <Text style={styles.label}>Withdraw to</Text>
        <View style={styles.bankRow}>
          <View style={styles.bankIcon}>
            <Ionicons name="business" size={20} color={colors.greenDark} />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={{ fontWeight: "700", fontSize: 15 }}>Bank account {"•••"} 1234</Text>
            <Text style={{ fontSize: 12, color: colors.textSecondary }}>Nordea Bank</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textLight} />
        </View>

        <Text style={styles.label}>Amount</Text>
        <View style={[styles.amountBox, !check.ok && { borderColor: colors.red }]}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={styles.amountText}>{"€"}</Text>
            <TextInput
              value={amountText}
              onChangeText={(t) => {
                setAmountText(t);
                setError(null);
              }}
              keyboardType="decimal-pad"
              inputMode="decimal"
              style={[styles.amountText, { flex: 1, padding: 0 }]}
              accessibilityLabel="Withdrawal amount in euros"
            />
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          {withdrawPresets(availableCents).map((preset) => (
            <Pressable
              key={preset.label}
              style={styles.presetPill}
              onPress={() => {
                setAmountText(formatAmountInput(preset.cents));
                setError(null);
              }}
            >
              <Text style={styles.presetLabel}>{preset.label}</Text>
            </Pressable>
          ))}
        </View>
        {!check.ok || error ? (
          <Text style={styles.errorText}>{error ?? (check.ok ? "" : check.message)}</Text>
        ) : null}
        <Text style={styles.minHint}>Minimum withdrawal: {formatEuros(MIN_WITHDRAWAL_AMOUNT_CENTS)}</Text>

        <Card style={{ marginTop: 16 }}>
          {[
            { label: "Withdrawal amount", value: shownAmount },
            { label: "Fee", value: formatEuros(0) },
          ].map((row) => (
            <View key={row.label} style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{row.label}</Text>
              <Text style={styles.summaryValue}>{row.value}</Text>
            </View>
          ))}
          <View style={styles.divider} />
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { fontWeight: "800", color: colors.textPrimary }]}>You receive</Text>
            <Text style={[styles.summaryValue, { color: colors.greenDark, fontSize: 17 }]}>{shownAmount}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Estimated arrival</Text>
            <Text style={styles.summaryValue}>1{"–"}3 business days</Text>
          </View>
        </Card>

        <View style={styles.infoPanel}>
          <Ionicons name="information-circle" size={16} color={colors.greenDark} />
          <Text style={styles.infoText}>
            Only your available balance can be withdrawn. Pending rewards cannot be withdrawn yet.
          </Text>
        </View>

        <View style={{ marginTop: 20, gap: 10 }}>
          <GreenButton label="Confirm Withdrawal" disabled={!check.ok} onPress={confirm} />
          <Pressable onPress={() => router.replace("/user/home")}>
            <Text style={{ textAlign: "center", color: colors.textSecondary, fontWeight: "700", paddingVertical: 10 }}>Cancel</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 8, paddingBottom: 6 },
  headerTitle: { fontSize: 19, fontWeight: "800" },
  hbLabel: { color: "#B9C1BB", fontSize: 12.5 },
  hbAmount: { color: "#fff", fontSize: 30, fontWeight: "800", marginTop: 4 },
  readyLabel: { color: colors.green, fontWeight: "700", fontSize: 12.5 },
  pendingLabel: { color: "#B9C1BB", fontSize: 11.5, marginTop: 6 },
  label: { fontSize: 12.5, color: colors.textSecondary, fontWeight: "700", marginTop: 18, marginBottom: 8 },
  bankRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 14 },
  bankIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.greenLight, alignItems: "center", justifyContent: "center" },
  amountBox: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, paddingVertical: 20, paddingHorizontal: 16 },
  amountText: { fontSize: 32, fontWeight: "800" },
  presetPill: { flex: 1, backgroundColor: colors.greenLight, borderRadius: radius.chip, alignItems: "center", paddingVertical: 10 },
  presetLabel: { color: colors.greenDark, fontWeight: "700" },
  errorText: { color: "#B3261E", fontSize: 12.5, fontWeight: "600", marginTop: 8 },
  minHint: { fontSize: 11.5, color: colors.textLight, marginTop: 8 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8 },
  summaryLabel: { fontSize: 13.5, color: colors.textSecondary },
  summaryValue: { fontSize: 13.5, fontWeight: "700" },
  divider: { height: 1, backgroundColor: colors.borderLight },
  infoPanel: { flexDirection: "row", gap: 8, backgroundColor: colors.greenLight, borderRadius: radius.card, padding: 14, marginTop: 16 },
  infoText: { flex: 1, fontSize: 12, color: "#0B7A38", lineHeight: 16 },
});
