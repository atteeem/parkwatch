import React, { useState } from "react";
import { View } from "react-native";
import { useApp } from "../../src/context/AppContext";
import { AdminPage } from "../../src/admin/AdminShell";
import { adminStyles, AuditList, FilterChips, ListFooter, PagedStates, SearchBox, Section, useAdminPaged } from "../../src/admin/AdminUI";
import { ACTOR_ROLE_LABEL, AUDIT_ENTITY_LABEL, DATE_PRESET_LABEL, DatePreset, dateRange } from "../../src/admin/adminViews";
import type { ActorRole, AdminAuditFilter, AuditEntityType } from "../../src/admin/adminTypes";

const ROLES: readonly ActorRole[] = ["CITIZEN", "OFFICER", "SYSTEM"];
const ENTITIES: readonly AuditEntityType[] = ["report", "officer_case", "inspection", "evidence", "outcome", "reward"];

// History of the organization's reports and cases (append-only audit events).
// Citizen-account events (withdrawals, notifications, profile) are not shown.
export default function AdminAudit() {
  const { admin } = useApp();
  const [actorRole, setActorRole] = useState<ActorRole | undefined>(undefined);
  const [entityType, setEntityType] = useState<AuditEntityType | undefined>(undefined);
  const [date, setDate] = useState<DatePreset>("7d");
  const [ref, setRef] = useState("");
  const filter: AdminAuditFilter = { actorRole, entityType, ref: ref || undefined, ...dateRange(date, new Date()) };
  const p = useAdminPaged((offset) => admin!.pageAudit(filter, offset), JSON.stringify({ actorRole, entityType, date, ref }));

  return (
    <AdminPage title="Audit log" subtitle="Who did what, and when, on your organization's reports and cases" onRefresh={p.reload}>
      <View style={adminStyles.filters}>
        <SearchBox placeholder="Report number or case id" value={ref} onSubmit={setRef} />
        <FilterChips label="Actor" value={actorRole} onChange={setActorRole} options={ROLES.map((r) => ({ value: r, label: ACTOR_ROLE_LABEL[r] }))} />
        <FilterChips label="Record" value={entityType} onChange={setEntityType} options={ENTITIES.map((e) => ({ value: e, label: AUDIT_ENTITY_LABEL[e] }))} />
        <FilterChips
          label="When"
          value={date === "all" ? undefined : date}
          onChange={(v) => setDate(v ?? "all")}
          allLabel={DATE_PRESET_LABEL.all}
          options={(["today", "7d", "30d"] as const).map((d) => ({ value: d, label: DATE_PRESET_LABEL[d] }))}
        />
      </View>
      <PagedStates p={p} emptyTitle="No events" emptyBody="No history matches these filters." />
      {p.rows.length > 0 ? (
        <Section title="Events">
          <AuditList events={p.rows} showReport />
          <ListFooter p={p} />
        </Section>
      ) : null}
    </AdminPage>
  );
}
