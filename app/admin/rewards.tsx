import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useApp } from "../../src/context/AppContext";
import { AdminPage } from "../../src/admin/AdminShell";
import { adminStyles, FilterChips, ListFooter, PagedStates, Pill, RowCard, SearchBox, StatTile, useAdminPaged } from "../../src/admin/AdminUI";
import { DATE_PRESET_LABEL, DatePreset, dateRange, formatEuros, formatStamp, REWARD_ENTRY_LABEL, REWARD_STATE_LABEL } from "../../src/admin/adminViews";
import type { AdminRewardFilter, AdminRewardSummary, RewardEntryType } from "../../src/admin/adminTypes";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const STATES = ["PENDING", "AVAILABLE", "VOIDED"] as const;
const ENTRY_TYPES: readonly RewardEntryType[] = ["REWARD_PENDING", "REWARD_RELEASED", "REWARD_VOIDED"];

// Reward ledger for monitoring and reconciliation. NOT a payment tool:
// nothing here moves money. One €5 reward per qualifying report.
export default function AdminRewards() {
  const router = useRouter();
  const params = useLocalSearchParams<{ state?: string }>();
  const { admin } = useApp();
  const initial = one(params.state);
  const [state, setState] = useState<AdminRewardFilter["state"]>((STATES as readonly string[]).includes(initial ?? "") ? (initial as AdminRewardFilter["state"]) : undefined);
  const [entryType, setEntryType] = useState<RewardEntryType | undefined>(undefined);
  const [date, setDate] = useState<DatePreset>("all");
  const [search, setSearch] = useState("");
  const filter: AdminRewardFilter = { state, entryType, search: search || undefined, ...dateRange(date, new Date()) };
  const p = useAdminPaged<import("../../src/admin/adminTypes").AdminRewardRow, AdminRewardSummary>(
    (offset) => admin!.pageRewards(filter, offset),
    JSON.stringify({ state, entryType, date, search })
  );
  const s = p.extra;

  return (
    <AdminPage title="Rewards" subtitle="Citizen reward ledger for your organization's reports" onRefresh={p.reload}>
      {s ? (
        <View style={styles.grid}>
          <StatTile label="Pending" value={`${s.pendingCount} · ${formatEuros(s.pendingCents)}`} hint="Reports awaiting an officer decision" />
          <StatTile label="Released" value={`${s.availableCount} · ${formatEuros(s.availableCents)}`} hint="Released to citizens' balances" />
          <StatTile label="Voided" value={s.voidedCount} hint="No reward (not a qualifying outcome)" />
        </View>
      ) : null}
      <Text style={adminStyles.muted}>
        One reward per qualifying report: a pending entry followed by a release counts once. ParkWatch does not make payouts from this console.
      </Text>
      <View style={adminStyles.filters}>
        <SearchBox placeholder="Report number" value={search} onSubmit={setSearch} />
        <FilterChips label="Reward state" value={state} onChange={setState} options={STATES.map((v) => ({ value: v, label: REWARD_STATE_LABEL[v] }))} />
        <FilterChips label="Entry" value={entryType} onChange={setEntryType} options={ENTRY_TYPES.map((v) => ({ value: v, label: REWARD_ENTRY_LABEL[v] }))} />
        <FilterChips
          label="Recorded"
          value={date === "all" ? undefined : date}
          onChange={(v) => setDate(v ?? "all")}
          allLabel={DATE_PRESET_LABEL.all}
          options={(["today", "7d", "30d"] as const).map((d) => ({ value: d, label: DATE_PRESET_LABEL[d] }))}
        />
      </View>

      <PagedStates p={p} emptyTitle="No ledger entries" emptyBody="No reward entries match these filters." />
      {p.rows.length > 0 ? (
        <View>
          {p.rows.map((r) => (
            <RowCard key={r.id} onPress={() => router.push(`/admin/reports/${r.publicNumber}` as never)} label={`${REWARD_ENTRY_LABEL[r.entryType]} for report ${r.publicNumber}`}>
              <View style={styles.colWhen}>
                <Text style={adminStyles.cell}>{formatStamp(r.createdAt)}</Text>
                <Text style={adminStyles.muted}>Report #{r.publicNumber}</Text>
              </View>
              <View style={styles.colMain}>
                <Text style={adminStyles.cellStrong}>{REWARD_ENTRY_LABEL[r.entryType] ?? r.entryType}</Text>
                <Text style={adminStyles.muted}>Citizen {r.citizenRef}</Text>
              </View>
              <Text style={styles.amount}>{formatEuros(r.amountCents)}</Text>
              <Pill text={REWARD_STATE_LABEL[r.rewardState]} tone={r.rewardState === "AVAILABLE" ? "green" : r.rewardState === "PENDING" ? "amber" : "neutral"} />
            </RowCard>
          ))}
          <ListFooter p={p} />
        </View>
      ) : null}
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  colWhen: { width: 150 },
  colMain: { flex: 1, minWidth: 160 },
  amount: { width: 80, textAlign: "right", fontWeight: "800", fontVariant: ["tabular-nums"] },
});
