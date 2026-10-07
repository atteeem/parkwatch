import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { radius } from "../../src/constants/spacing";
import { BackHeader } from "../../src/components/Header";
import { Card } from "../../src/components/Card";
import { GreenButton } from "../../src/components/GreenButton";
import { EmptyState } from "../../src/components/EmptyState";
import { useApp } from "../../src/context/AppContext";
import { describeDomainError } from "../../src/presentation/errors";
import { monthRange, MonthlyStats, weeklyBreakdown } from "../../src/presentation/officerStats";

// Officer Monthly Statistics. Only what is recorded: the outcomes this
// officer decided and when. BACKEND: a server query for the signed-in officer
// (never computed from the loaded Cases pages). LOCAL_DEMO: the local store.
export default function OfficerStatistics() {
  const router = useRouter();
  const { loadOfficerMonthlyStats, dataSource } = useApp();
  const [monthsBack, setMonthsBack] = useState(0);
  const [state, setState] = useState<{ phase: "loading" } | { phase: "error"; message: string } | { phase: "ready"; stats: MonthlyStats }>({ phase: "loading" });
  const range = monthRange(new Date(), monthsBack);

  const load = useCallback(() => {
    let live = true;
    setState({ phase: "loading" });
    const r = monthRange(new Date(), monthsBack);
    void loadOfficerMonthlyStats({ from: r.from, to: r.to }).then((res) => {
      if (!live) return;
      setState(res.ok ? { phase: "ready", stats: res.value } : { phase: "error", message: describeDomainError(res.error).message });
    });
    return () => {
      live = false;
    };
  }, [monthsBack, loadOfficerMonthlyStats]);
  useEffect(load, [monthsBack]); // eslint-disable-line react-hooks/exhaustive-deps

  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/officer/profile"));

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <BackHeader title="Monthly Statistics" subtitle="Decisions you recorded" onBack={goBack} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 14 }}>
        <View style={styles.monthRow}>
          <Pressable onPress={() => setMonthsBack((m) => Math.min(m + 1, 11))} hitSlop={10} accessibilityRole="button" accessibilityLabel="Previous month" style={styles.monthBtn}>
            <Ionicons name="chevron-back" size={18} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.monthLabel} accessibilityRole="header">
            {range.label}
          </Text>
          <Pressable
            onPress={() => setMonthsBack((m) => Math.max(m - 1, 0))}
            disabled={monthsBack === 0}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Next month"
            accessibilityState={{ disabled: monthsBack === 0 }}
            style={[styles.monthBtn, monthsBack === 0 && { opacity: 0.3 }]}
          >
            <Ionicons name="chevron-forward" size={18} color={colors.textPrimary} />
          </Pressable>
        </View>

        {state.phase === "loading" ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.greenDark} />
          </View>
        ) : state.phase === "error" ? (
          <Card>
            <Text style={styles.errorText}>{state.message}</Text>
            <GreenButton label="Try again" small onPress={load} style={{ marginTop: 12 }} />
          </Card>
        ) : (
          <>
            <View style={styles.grid}>
              <Stat icon="checkmark-done" label="Cases completed" value={state.stats.completed} color={colors.greenDark} />
              <Stat icon="receipt-outline" label="Parking charges issued" value={state.stats.issued} color="#B47A00" />
              <Stat icon="close-circle-outline" label="Reports rejected" value={state.stats.rejected} color={colors.red} />
              <Stat icon="remove-circle-outline" label="Closed without a charge" value={state.stats.noCharge} color={colors.blue} />
            </View>

            {state.stats.completed === 0 ? (
              <EmptyState
                variant="compact"
                icon="stats-chart"
                title="No decisions recorded this month"
                body="Completed cases appear here by the day you decided them."
              />
            ) : (
              <Card>
                <Text style={styles.sectionTitle}>By week</Text>
                {weeklyBreakdown(state.stats, range).map((w) => {
                  const max = Math.max(1, state.stats.completed);
                  return (
                    <View
                      key={w.label}
                      style={styles.weekRow}
                      accessible
                      accessibilityLabel={`${w.label}: ${w.completed} completed, ${w.issued} charges, ${w.rejected} rejected, ${w.noCharge} without a charge`}
                    >
                      <Text style={styles.weekLabel}>{w.label}</Text>
                      <View style={styles.barTrack}>
                        <View style={[styles.bar, { width: `${(w.completed / max) * 100}%` }]} />
                      </View>
                      <Text style={styles.weekValue}>{w.completed}</Text>
                    </View>
                  );
                })}
              </Card>
            )}

            <Text style={styles.note}>
              {dataSource === "BACKEND"
                ? "Counted on the server from the outcomes you recorded, by the day you decided them."
                : "Local demo: counted from the outcomes recorded on this device."}{" "}
              Response times, distances and money collected are not recorded, so they are not shown.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ icon, label, value, color }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; value: number; color: string }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${label}: ${value}`}>
      <Ionicons name={icon} size={20} color={color} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  monthBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  monthLabel: { fontSize: 17, fontWeight: "800" },
  center: { padding: 40, alignItems: "center" },
  errorText: { color: "#B3261E", fontWeight: "600" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  stat: { width: "48%", flexGrow: 1, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 14, gap: 4 },
  statValue: { fontSize: 24, fontWeight: "800" },
  statLabel: { fontSize: 12, color: colors.textSecondary, fontWeight: "600" },
  sectionTitle: { fontSize: 15, fontWeight: "800", marginBottom: 8 },
  weekRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  weekLabel: { width: 84, fontSize: 12.5, color: colors.textSecondary, fontWeight: "600" },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.backgroundSunk, overflow: "hidden" },
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.greenDark },
  weekValue: { width: 28, textAlign: "right", fontWeight: "800" },
  note: { fontSize: 11.5, color: colors.textSecondary, lineHeight: 16 },
});
