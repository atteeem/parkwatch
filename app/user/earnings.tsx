import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, Image, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { radius, BOTTOM_NAV_HEIGHT } from "../../src/constants/spacing";
import { Card } from "../../src/components/Card";
import { useApp } from "../../src/context/AppContext";

const PERIODS = ["All time", "Today", "This week", "This month"];
const CHART_VALUES = [2, 4, 6, 5, 10, 9, 15, 13, 18, 24, 22, 40];

export default function Earnings() {
  const router = useRouter();
  const { walletAvailable, walletPending, walletPaidOut } = useApp();
  const [period, setPeriod] = useState("Today");
  const max = Math.max(...CHART_VALUES);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.headerRow}>
        <Ionicons name="menu" size={22} color={colors.textPrimary} />
        <Text style={styles.headerTitle}>Earnings</Text>
        <Image source={{ uri: "https://picsum.photos/seed/profileuser/100/100" }} style={styles.avatar} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: BOTTOM_NAV_HEIGHT + 20 }}>
        <Card dark>
          <Text style={styles.hbLabel}>Available balance</Text>
          <Text style={styles.hbAmount}>{"\u20ac"}{walletAvailable.toFixed(2)}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="checkmark-circle" size={14} color={colors.green} />
            <Text style={styles.readyLabel}>Ready to withdraw</Text>
          </View>
          <Text style={styles.pendingLabel}>{"\u20ac"}{walletPending.toFixed(2)} pending verification</Text>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
            <Pressable style={styles.solidBtn} onPress={() => router.push("/user/withdraw")}>
              <Text style={styles.solidBtnLabel}>Withdraw</Text>
              <Ionicons name="chevron-forward" size={14} color="#06210F" />
            </Pressable>
            <Pressable style={styles.outlineBtn}>
              <Text style={styles.outlineBtnLabel}>Transaction history</Text>
              <Ionicons name="chevron-forward" size={14} color="#fff" />
            </Pressable>
          </View>
        </Card>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 16 }} contentContainerStyle={{ gap: 8 }}>
          {PERIODS.map((p) => (
            <Pressable key={p} onPress={() => setPeriod(p)} style={[styles.periodPill, period === p && styles.periodPillActive]}>
              <Text style={[styles.periodLabel, period === p && styles.periodLabelActive]}>{p}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <Card style={{ marginTop: 16 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
            <View>
              <Text style={styles.chartLabel}>Earnings</Text>
              <Text style={styles.chartAmount}>{"\u20ac40.00"}</Text>
              <Text style={styles.chartSub}>8 verified reports</Text>
            </View>
            <Text style={styles.chartUp}>{"\u2191"}20% month over month</Text>
          </View>
          <View style={styles.chartRow}>
            {CHART_VALUES.map((v, i) => (
              <View key={i} style={[styles.bar, { height: 10 + (v / max) * 90 }]} />
            ))}
          </View>
        </Card>

        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Ionicons name="wallet" size={18} color={colors.greenDark} />
            <Text style={styles.summaryValue}>{"\u20ac"}{walletAvailable.toFixed(2)}</Text>
            <Text style={styles.summaryLabel}>Available</Text>
            <Text style={styles.summarySub}>Ready to withdraw</Text>
          </View>
          <View style={styles.summaryItem}>
            <Ionicons name="time" size={18} color="#B47A00" />
            <Text style={styles.summaryValue}>{"\u20ac"}{walletPending.toFixed(2)}</Text>
            <Text style={styles.summaryLabel}>Pending</Text>
            <Text style={styles.summarySub}>Under verification</Text>
          </View>
          <View style={styles.summaryItem}>
            <Ionicons name="arrow-up-circle" size={18} color={colors.blue} />
            <Text style={styles.summaryValue}>{"\u20ac"}{walletPaidOut.toFixed(2)}</Text>
            <Text style={styles.summaryLabel}>Paid out</Text>
            <Text style={styles.summarySub}>Total withdrawn</Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 20, marginBottom: 10 }}>
          <Text style={{ fontSize: 17, fontWeight: "800" }}>Recent activity</Text>
          <Text style={{ color: colors.greenDark, fontWeight: "700" }}>View all</Text>
        </View>
        {[
          { icon: "checkmark-circle", label: "Reward added", sub: "GHC-789 \u2022 Verified report", amount: "+\u20ac5.00", tone: colors.greenDark },
          { icon: "business", label: "Withdrawal completed", sub: "Bank account \u2022\u2022\u2022\u2022 4821", amount: "-\u20ac25.00", tone: colors.textPrimary },
          { icon: "time", label: "Reward pending", sub: "JEH-523 \u2022 Under review", amount: "\u20ac5.00", tone: "#B47A00" },
        ].map((row, i) => (
          <View key={i} style={styles.activityRow}>
            <Ionicons name={row.icon as any} size={20} color={row.tone} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ fontWeight: "700", fontSize: 13.5 }}>{row.label}</Text>
              <Text style={{ fontSize: 11.5, color: colors.textSecondary, marginTop: 2 }}>{row.sub}</Text>
            </View>
            <Text style={{ fontWeight: "800", color: row.tone }}>{row.amount}</Text>
          </View>
        ))}
      </ScrollView>
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
  chartUp: { fontSize: 11.5, color: colors.greenDark, fontWeight: "700" },
  chartRow: { flexDirection: "row", alignItems: "flex-end", gap: 4, height: 100, marginTop: 16 },
  bar: { flex: 1, backgroundColor: colors.green, borderRadius: 3 },
  summaryRow: { flexDirection: "row", marginTop: 16, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 14 },
  summaryItem: { flex: 1, alignItems: "flex-start", gap: 3 },
  summaryValue: { fontSize: 17, fontWeight: "800" },
  summaryLabel: { fontSize: 12, fontWeight: "700" },
  summarySub: { fontSize: 10.5, color: colors.textLight },
  activityRow: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: colors.borderLight, paddingVertical: 12 },
});
