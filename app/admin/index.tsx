import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { colors } from "../../src/constants/colors";
import { useApp } from "../../src/context/AppContext";
import { AdminPage } from "../../src/admin/AdminShell";
import { FailureState, LoadingState, Section, StatTile, useAdminLoad } from "../../src/admin/AdminUI";
import { formatEuros } from "../../src/admin/adminViews";
import type { AdminOverview } from "../../src/admin/adminTypes";

// Operations overview. Every number is counted from real records (server in
// BACKEND mode, the local store in the demo). No revenue or money collected:
// ParkWatch does not record parking-charge payments.
export default function AdminHome() {
  const router = useRouter();
  const { admin } = useApp();
  const load = useAdminLoad(() => admin!.overview(), "overview");

  return (
    <AdminPage title="Overview" subtitle="Your organization's reports and cases right now" onRefresh={load.reload} refreshing={false}>
      {load.phase === "loading" ? (
        <LoadingState />
      ) : load.phase === "failed" ? (
        <FailureState failure={load.failure} onRetry={load.reload} />
      ) : (
        <OverviewBody o={load.data} go={(p) => router.push(p as never)} />
      )}
    </AdminPage>
  );
}

function OverviewBody({ o, go }: { o: AdminOverview; go: (path: string) => void }) {
  const max = Math.max(1, ...o.last7Days.map((d) => Math.max(d.received, d.completed)));
  return (
    <>
      <Text style={styles.group}>Incoming</Text>
      <View style={styles.grid}>
        <StatTile label="Reports under review" value={o.reportsUnderReview} onPress={() => go("/admin/reports?status=UNDER_REVIEW")} />
        <StatTile label="Reports received today" value={o.reportsReceivedToday} onPress={() => go("/admin/reports?date=today")} />
      </View>

      <Text style={styles.group}>Cases</Text>
      <View style={styles.grid}>
        <StatTile label="Active cases" value={o.casesActive} hint="Not yet completed" />
        <StatTile label="New / unassigned" value={o.casesNew} onPress={() => go("/admin/cases?status=NEW")} />
        <StatTile label="Assigned" value={o.casesAssigned} onPress={() => go("/admin/cases?status=ASSIGNED")} />
        <StatTile label="En route" value={o.casesEnRoute} onPress={() => go("/admin/cases?status=EN_ROUTE")} />
        <StatTile label="On site / inspection" value={o.casesOnSite} onPress={() => go("/admin/cases?status=INSPECTION")} />
        <StatTile label="High priority open" value={o.casesHighPriorityOpen} onPress={() => go("/admin/cases?priority=HIGH")} />
      </View>

      <Text style={styles.group}>Decided today</Text>
      <View style={styles.grid}>
        <StatTile label="Completed today" value={o.completedToday} />
        <StatTile label="Parking charges issued" value={o.chargesToday} onPress={() => go("/admin/cases?outcome=CHARGE_ISSUED&date=today")} />
        <StatTile label="Reports rejected" value={o.rejectedToday} onPress={() => go("/admin/cases?outcome=REPORT_REJECTED&date=today")} />
        <StatTile label="Closed without a charge" value={o.noChargeToday} hint="Moved, permit, duplicate, other" />
      </View>

      <Text style={styles.group}>Citizen rewards</Text>
      <View style={styles.grid}>
        <StatTile label="Pending rewards" value={`${o.rewardsPendingCount} · ${formatEuros(o.rewardsPendingCents)}`} hint="Waiting for an officer decision" onPress={() => go("/admin/rewards?state=PENDING")} />
        <StatTile label="Released rewards" value={`${o.rewardsAvailableCount} · ${formatEuros(o.rewardsAvailableCents)}`} hint="Released to citizens' balances" onPress={() => go("/admin/rewards?state=AVAILABLE")} />
      </View>

      <Section title="Last 7 days">
        <View style={styles.legend}>
          <View style={[styles.dot, { backgroundColor: colors.greenDark }]} />
          <Text style={styles.legendText}>Reports received</Text>
          <View style={[styles.dot, { backgroundColor: "#9DB5A6" }]} />
          <Text style={styles.legendText}>Cases completed</Text>
        </View>
        {o.last7Days.map((d) => (
          <View key={d.day} style={styles.dayRow} accessible accessibilityLabel={`${d.day}: ${d.received} received, ${d.completed} completed`}>
            <Text style={styles.day}>{d.day.slice(5).split("-").reverse().join(".")}</Text>
            <View style={{ flex: 1, gap: 3 }}>
              <View style={[styles.bar, { width: `${(d.received / max) * 100}%`, backgroundColor: colors.greenDark }]} />
              <View style={[styles.bar, { width: `${(d.completed / max) * 100}%`, backgroundColor: "#9DB5A6" }]} />
            </View>
            <Text style={styles.dayNums}>
              {d.received} / {d.completed}
            </Text>
          </View>
        ))}
      </Section>
      <Text style={styles.note}>Counts come from recorded reports, cases and ledger entries. ParkWatch does not record whether parking charges were paid.</Text>
    </>
  );
}

const styles = StyleSheet.create({
  group: { fontSize: 12, fontWeight: "800", color: colors.textSecondary, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: -6 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  legend: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12, color: colors.textSecondary, marginRight: 10 },
  dayRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  day: { width: 48, fontSize: 12.5, color: colors.textSecondary, fontVariant: ["tabular-nums"] },
  bar: { height: 6, borderRadius: 3, minWidth: 2 },
  dayNums: { width: 54, textAlign: "right", fontSize: 12.5, fontWeight: "700", fontVariant: ["tabular-nums"] },
  note: { fontSize: 11.5, color: colors.textSecondary },
});
