import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useApp } from "../../../src/context/AppContext";
import { AdminPage } from "../../../src/admin/AdminShell";
import { adminStyles, FilterChips, ListFooter, PagedStates, Pill, RowCard, SearchBox, useAdminLoad, useAdminPaged } from "../../../src/admin/AdminUI";
import {
  CASE_STATUSES,
  CASE_STATUS_LABEL,
  DATE_PRESET_LABEL,
  DatePreset,
  dateRange,
  formatEuros,
  formatStamp,
  OUTCOME_CODES,
  outcomeText,
  PRIORITIES,
  PRIORITY_LABEL,
  violationLabel,
} from "../../../src/admin/adminViews";
import type { AdminCaseFilter } from "../../../src/admin/adminTypes";
import type { CaseStatus, EnforcementOutcomeCode, ReportPriority } from "../../../src/domain";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const pick = <T extends string>(v: string | undefined, allowed: readonly T[]): T | undefined => (allowed as readonly string[]).includes(v ?? "") ? (v as T) : undefined;

// Officer cases of the organization. Server-side filters and paging.
export default function AdminCases() {
  const router = useRouter();
  const params = useLocalSearchParams<{ status?: string; priority?: string; outcome?: string; date?: string; officer?: string }>();
  const { admin } = useApp();
  const [status, setStatus] = useState<CaseStatus | undefined>(pick(one(params.status), CASE_STATUSES));
  // Only a filter value: the server still limits results to the caller's organization.
  const [officerId, setOfficerId] = useState<string | undefined>(one(params.officer) || undefined);
  const [outcome, setOutcome] = useState<EnforcementOutcomeCode | undefined>(pick(one(params.outcome), OUTCOME_CODES));
  const [priority, setPriority] = useState<ReportPriority | undefined>(pick(one(params.priority), PRIORITIES));
  const [date, setDate] = useState<DatePreset>(pick(one(params.date), ["today", "7d", "30d"] as const) ?? "all");
  const [search, setSearch] = useState("");
  const officers = useAdminLoad(() => admin!.listOfficers(), "officers");

  const filter: AdminCaseFilter = { status, officerId, outcome, priority, search: search || undefined, ...dateRange(date, new Date()) };
  const key = JSON.stringify({ status, officerId, outcome, priority, date, search });
  const p = useAdminPaged((offset) => admin!.pageCases(filter, offset), key);
  const officerOptions =
    officers.phase === "ready"
      ? officers.data.filter((o) => o.memberRole === "OFFICER" || o.activeCases > 0).map((o) => ({ value: o.userId, label: o.displayName ?? "Unnamed officer" }))
      : [];

  return (
    <AdminPage title="Cases" subtitle="Officer cases created from citizen reports" onRefresh={p.reload}>
      <View style={adminStyles.filters}>
        <SearchBox placeholder="Report number or plate" value={search} onSubmit={setSearch} />
        <FilterChips label="Status" value={status} onChange={setStatus} options={CASE_STATUSES.map((s) => ({ value: s, label: CASE_STATUS_LABEL[s] }))} />
        <FilterChips label="Outcome" value={outcome} onChange={setOutcome} options={OUTCOME_CODES.map((c) => ({ value: c, label: outcomeText(c) }))} />
        <FilterChips label="Priority" value={priority} onChange={setPriority} options={PRIORITIES.map((s) => ({ value: s, label: PRIORITY_LABEL[s] }))} />
        {officerOptions.length ? <FilterChips label="Assigned officer" value={officerId} onChange={setOfficerId} options={officerOptions} /> : null}
        <FilterChips
          label="Created"
          value={date === "all" ? undefined : date}
          onChange={(v) => setDate(v ?? "all")}
          allLabel={DATE_PRESET_LABEL.all}
          options={(["today", "7d", "30d"] as const).map((d) => ({ value: d, label: DATE_PRESET_LABEL[d] }))}
        />
      </View>

      <PagedStates p={p} emptyTitle="No cases" emptyBody="No cases match these filters." />
      {p.rows.length > 0 ? (
        <View>
          {p.rows.map((c) => (
            <RowCard key={c.id} onPress={() => router.push(`/admin/cases/${c.id}` as never)} label={`Case for report ${c.publicNumber}`}>
              <View style={styles.colNum}>
                <Text style={adminStyles.cellStrong}>Report #{c.publicNumber}</Text>
                <Text style={adminStyles.muted}>Case {c.id.slice(0, 8)}</Text>
              </View>
              <View style={styles.colMain}>
                <Text style={adminStyles.cell} numberOfLines={1}>
                  {[c.plate, violationLabel(c.violationType)].filter(Boolean).join(" · ")}
                </Text>
                <Text style={adminStyles.muted} numberOfLines={1}>
                  {c.locationAddress}
                </Text>
              </View>
              <View style={styles.colTags}>
                <Pill text={CASE_STATUS_LABEL[c.status]} tone={c.status === "COMPLETED" ? "neutral" : c.status === "NEW" ? "amber" : "blue"} />
                {c.priority === "HIGH" ? <Pill text="High priority" tone="red" /> : null}
              </View>
              <View style={styles.colSide}>
                <Text style={adminStyles.muted} numberOfLines={1}>
                  {c.assignedOfficerName ?? (c.status === "NEW" ? "Unassigned" : "—")}
                </Text>
                <Text style={adminStyles.muted} numberOfLines={1}>
                  {c.outcomeCode
                    ? `${outcomeText(c.outcomeCode)}${c.parkingChargeCents !== undefined ? ` · ${formatEuros(c.parkingChargeCents)}` : ""}`
                    : `Created ${formatStamp(c.createdAt)}`}
                </Text>
              </View>
            </RowCard>
          ))}
          <ListFooter p={p} />
        </View>
      ) : null}
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  colNum: { width: 140 },
  colMain: { flex: 1, minWidth: 160 },
  colTags: { gap: 4, alignItems: "flex-start", width: 120 },
  colSide: { width: 220 },
});
