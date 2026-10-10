import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useApp } from "../../../src/context/AppContext";
import { AdminPage } from "../../../src/admin/AdminShell";
import { adminStyles, FilterChips, ListFooter, PagedStates, Pill, RowCard, SearchBox, useAdminPaged } from "../../../src/admin/AdminUI";
import {
  CASE_STATUS_LABEL,
  DATE_PRESET_LABEL,
  DatePreset,
  dateRange,
  formatStamp,
  outcomeText,
  PRIORITIES,
  PRIORITY_LABEL,
  REPORT_STATUSES,
  REPORT_STATUS_LABEL,
  violationLabel,
} from "../../../src/admin/adminViews";
import type { AdminReportFilter } from "../../../src/admin/adminTypes";
import type { CitizenReportStatus, ReportPriority } from "../../../src/domain";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const pick = <T extends string>(v: string | undefined, allowed: readonly T[]): T | undefined => (allowed as readonly string[]).includes(v ?? "") ? (v as T) : undefined;

// Reports of the organization. Filtering and paging run on the server; the
// list is never filtered from the rows already loaded.
export default function AdminReports() {
  const router = useRouter();
  const params = useLocalSearchParams<{ status?: string; priority?: string; date?: string; q?: string }>();
  const { admin } = useApp();
  const [status, setStatus] = useState<CitizenReportStatus | undefined>(pick(one(params.status), REPORT_STATUSES));
  const [priority, setPriority] = useState<ReportPriority | undefined>(pick(one(params.priority), PRIORITIES));
  const [caseState, setCaseState] = useState<AdminReportFilter["caseState"]>(undefined);
  const [date, setDate] = useState<DatePreset>(pick(one(params.date), ["today", "7d", "30d"] as const) ?? "all");
  const [search, setSearch] = useState(one(params.q) ?? "");

  const filter: AdminReportFilter = { status, priority, caseState, search: search || undefined, ...dateRange(date, new Date()) };
  const key = JSON.stringify({ status, priority, caseState, date, search });
  const p = useAdminPaged((offset) => admin!.pageReports(filter, offset), key);

  return (
    <AdminPage title="Reports" subtitle="Citizen reports received by your organization" onRefresh={p.reload}>
      <View style={adminStyles.filters}>
        <SearchBox placeholder="Report number or plate" value={search} onSubmit={setSearch} />
        <FilterChips label="Report status" value={status} onChange={setStatus} options={REPORT_STATUSES.map((s) => ({ value: s, label: REPORT_STATUS_LABEL[s] }))} />
        <FilterChips label="Priority" value={priority} onChange={setPriority} options={PRIORITIES.map((s) => ({ value: s, label: PRIORITY_LABEL[s] }))} />
        <FilterChips
          label="Case"
          value={caseState}
          onChange={setCaseState}
          options={[
            { value: "active", label: "Active case" },
            { value: "completed", label: "Completed" },
          ]}
        />
        <FilterChips
          label="Received"
          value={date === "all" ? undefined : date}
          onChange={(v) => setDate(v ?? "all")}
          allLabel={DATE_PRESET_LABEL.all}
          options={(["today", "7d", "30d"] as const).map((d) => ({ value: d, label: DATE_PRESET_LABEL[d] }))}
        />
      </View>

      <PagedStates p={p} emptyTitle="No reports" emptyBody="No reports match these filters." />
      {p.rows.length > 0 ? (
        <View>
          {p.rows.map((r) => (
            <RowCard key={r.id} onPress={() => router.push(`/admin/reports/${r.publicNumber}` as never)} label={`Report ${r.publicNumber}`}>
              <View style={styles.colNum}>
                <Text style={adminStyles.cellStrong}>#{r.publicNumber}</Text>
                <Text style={adminStyles.muted}>{formatStamp(r.receivedAt ?? r.submittedAt)}</Text>
              </View>
              <View style={styles.colMain}>
                <Text style={adminStyles.cell} numberOfLines={1}>
                  {[r.plate, violationLabel(r.violationType)].filter(Boolean).join(" · ")}
                </Text>
                <Text style={adminStyles.muted} numberOfLines={1}>
                  {r.locationAddress}
                </Text>
              </View>
              <View style={styles.colTags}>
                <Pill text={REPORT_STATUS_LABEL[r.status]} tone={r.status === "VERIFIED" ? "green" : r.status === "REJECTED" ? "red" : "amber"} />
                {r.caseStatus ? <Pill text={`Case: ${CASE_STATUS_LABEL[r.caseStatus]}`} tone={r.caseStatus === "COMPLETED" ? "neutral" : "blue"} /> : null}
                {r.priority === "HIGH" ? <Pill text="High priority" tone="red" /> : null}
              </View>
              <View style={styles.colOfficer}>
                <Text style={adminStyles.muted} numberOfLines={1}>
                  {r.outcomeCode ? outcomeText(r.outcomeCode) : r.assignedOfficerName ? `Officer: ${r.assignedOfficerName}` : "Unassigned"}
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
  colNum: { width: 120 },
  colMain: { flex: 1, minWidth: 160 },
  colTags: { gap: 4, alignItems: "flex-start", width: 150 },
  colOfficer: { width: 170 },
});
