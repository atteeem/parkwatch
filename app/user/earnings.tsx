import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { radius, BOTTOM_NAV_HEIGHT } from "../../src/constants/spacing";
import { Card } from "../../src/components/Card";
import { useApp, WITHDRAWALS_UNAVAILABLE_COPY } from "../../src/context/AppContext";
import { useCoreRefreshControl } from "../../src/components/CoreDataGate";
import { useAuth } from "../../src/auth/AuthContext";
import { displayIdentity } from "../../src/auth/identity";
import { Avatar } from "../../src/components/Avatar";
import { UserBottomNav } from "../../src/components/UserBottomNav";
import { formatEuros } from "../../src/presentation/viewModels";
import { EARNINGS_PERIODS, EarningsPeriod } from "../../src/presentation/walletViews";
import { WalletActivityRow } from "../../src/components/WalletActivityRow";

export default function Earnings() {
  const router = useRouter();
  // All figures below come from the reward ledger (no hardcoded amounts).
  const { walletAvailable, walletPending, walletPaidOut, walletActivity, getEarnings, capabilities } = useApp();
  const refreshControl = useCoreRefreshControl();
  const [period, setPeriod] = useState<EarningsPeriod>("ALL_TIME");
  const earnings = getEarnings(period);
  const me = displayIdentity(useAuth().state, "citizen");
  const max = Math.max(...earnings.buckets, 1);
  const eur = (v: number) => formatEuros(Math.round(v * 100));

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/user/profile"))} hitSlop={10} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Earnings</Text>
        <Avatar name={me.fullName} size={40} />
      </View>

      <ScrollView refreshControl={refreshControl} contentContainerStyle={{ padding: 20, paddingBottom: BOTTOM_NAV_HEIGHT + 20 }}>
        <Card dark>
          <Text style={styles.hbLabel}>Available balance</Text>
          <Text style={styles.hbAmount}>{eur(walletAvailable)}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="checkmark-circle" size={14} color={colors.green} />
            <Text style={styles.readyLabel}>Ready to withdraw</Text>
          </View>
          <Text style={styles.pendingLabel}>{eur(walletPending)} pending verification</Text>
          {!capabilities.withdrawals && <Text style={styles.pendingLabel}>{WITHDRAWALS_UNAVAILABLE_COPY}</Text>}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
            <Pressable
              style={[styles.solidBtn, !capabilities.withdrawals && { opacity: 0.45 }]}
              disabled={!capabilities.withdrawals}
              accessibilityRole="button"
              accessibilityState={{ disabled: !capabilities.withdrawals }}
              onPress={() => router.push("/user/withdraw")}
            >
              <Text style={styles.solidBtnLabel}>Withdraw</Text>
              <Ionicons name="chevron-forward" size={14} color="#06210F" />
            </Pressable>
            <Pressable style={styles.outlineBtn} onPress={() => router.push("/user/earnings/history")} accessibilityRole="button">
              <Text style={styles.outlineBtnLabel}>Transaction history</Text>
              <Ionicons name="chevron-forward" size={14} color="#fff" />
            </Pressable>
          </View>
        </Card>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 16 }} contentContainerStyle={{ gap: 8 }}>
          {EARNINGS_PERIODS.map((p) => (
            <Pressable key={p.key} onPress={() => setPeriod(p.key)} style={[styles.periodPill, period === p.key && styles.periodPillActive]}>
              <Text style={[styles.periodLabel, period === p.key && styles.periodLabelActive]}>{p.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <Card style={{ marginTop: 16 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
            <View>
              <Text style={styles.chartLabel}>Earnings</Text>
              <Text style={styles.chartAmount}>{earnings.totalText}</Text>
              <Text style={styles.chartSub}>{earnings.verifiedCount} verified {earnings.verifiedCount === 1 ? "report" : "reports"}</Text>
            </View>
          </View>
          <View style={styles.chartRow}>
            {earnings.buckets.map((v, i) => (
              <View key={i} style={[styles.bar, { height: 6 + (v / max) * 94, opacity: v > 0 ? 1 : 0.35 }]} />
            ))}
          </View>
        </Card>

        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Ionicons name="wallet" size={18} color={colors.greenDark} />
            <Text style={styles.summaryValue}>{eur(walletAvailable)}</Text>
            <Text style={styles.summaryLabel}>Available</Text>
            <Text style={styles.summarySub}>Ready to withdraw</Text>
          </View>
          <View style={styles.summaryItem}>
            <Ionicons name="time" size={18} color="#B47A00" />
            <Text style={styles.summaryValue}>{eur(walletPending)}</Text>
            <Text style={styles.summaryLabel}>Pending</Text>
            <Text style={styles.summarySub}>Under verification</Text>
          </View>
          <View style={styles.summaryItem}>
            <Ionicons name="arrow-up-circle" size={18} color={colors.blue} />
            <Text style={styles.summaryValue}>{eur(walletPaidOut)}</Text>
            <Text style={styles.summaryLabel}>Paid out</Text>
            <Text style={styles.summarySub}>Total withdrawn</Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 20, marginBottom: 10 }}>
          <Text style={{ fontSize: 17, fontWeight: "800" }}>Recent activity</Text>
          <Pressable onPress={() => router.push("/user/earnings/history")} hitSlop={10} accessibilityRole="link">
            <Text style={{ color: colors.greenDark, fontWeight: "700" }}>View all</Text>
          </Pressable>
        </View>
        {walletActivity.length === 0 && (
          <Text style={{ fontSize: 13, color: colors.textSecondary }}>No wallet activity yet.</Text>
        )}
        {walletActivity.slice(0, 5).map((row) => (
          <WalletActivityRow key={row.id} row={row} />
        ))}
      </ScrollView>
      <UserBottomNav />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 8 },
  headerTitle: { fontSize: 19, fontWeight: "800" },
  avatar: { width: 34, height: 34, borderRadius: 17 },
  hbLabel: { color: "#B9C1BB", fontSize: 12.5 },
  hbAmount: { color: "#fff", fontSize: 30, fontWeight: "800", marginTop: 4 },
  readyLabel: { color: colors.green, fontWeight: "700", fontSize: 12.5 },
  pendingLabel: { color: "#B9C1BB", fontSize: 11.5, marginTop: 6 },
  solidBtn: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", backgroundColor: colors.green, borderRadius: radius.chip, paddingVertical: 12 },
  solidBtnLabel: { color: "#06210F", fontWeight: "700", fontSize: 13 },
  outlineBtn: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)", borderRadius: radius.chip, paddingVertical: 12 },
  outlineBtnLabel: { color: "#fff", fontWeight: "700", fontSize: 13 },
  periodPill: { borderRadius: radius.chip, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.backgroundSunk },
  periodPillActive: { backgroundColor: colors.cardBlack },
  periodLabel: { fontWeight: "700", fontSize: 13, color: colors.textPrimary },
  periodLabelActive: { color: "#fff" },
  chartLabel: { fontSize: 13, color: colors.textSecondary, fontWeight: "600" },
  chartAmount: { fontSize: 24, fontWeight: "800", marginTop: 2 },
  chartSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  chartRow: { flexDirection: "row", alignItems: "flex-end", gap: 4, height: 100, marginTop: 16 },
  bar: { flex: 1, backgroundColor: colors.green, borderRadius: 3 },
  summaryRow: { flexDirection: "row", marginTop: 16, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 14 },
  summaryItem: { flex: 1, alignItems: "flex-start", gap: 3 },
  summaryValue: { fontSize: 17, fontWeight: "800" },
  summaryLabel: { fontSize: 12, fontWeight: "700" },
  summarySub: { fontSize: 10.5, color: colors.textLight },
  activityRow: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: colors.borderLight, paddingVertical: 12 },
});
