import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../../src/constants/colors";
import { BackHeader } from "../../../src/components/Header";
import { WalletActivityRow } from "../../../src/components/WalletActivityRow";
import { EmptyFromCopy } from "../../../src/components/EmptyState";
import { TRANSACTION_HISTORY_EMPTY } from "../../../src/presentation/emptyStates";
import { useApp } from "../../../src/context/AppContext";

// Transaction history: EVERY wallet activity derived from the reward ledger
// (rewards pending / available / cancelled, withdrawals requested / paid,
// opening balance), newest first. No bank transactions are invented.
export default function TransactionHistory() {
  const router = useRouter();
  const { walletActivity } = useApp();

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <BackHeader
        title="Transaction History"
        subtitle="All wallet activity"
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/user/earnings"))}
      />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>
        {walletActivity.length === 0 ? (
          <EmptyFromCopy copy={TRANSACTION_HISTORY_EMPTY} />
        ) : (
          walletActivity.map((row) => <WalletActivityRow key={row.id} row={row} />)
        )}
        {walletActivity.length > 0 && (
          <Text style={styles.note}>Withdrawals are recorded in the demo; no real bank transfer is made.</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  empty: { alignItems: "center", padding: 32 },
  emptyTitle: { fontWeight: "800", fontSize: 16, marginTop: 8 },
  emptyText: { fontSize: 13, color: colors.textSecondary, marginTop: 4 },
  note: { fontSize: 12, color: colors.textLight, textAlign: "center", marginTop: 16 },
});
