import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useApp } from "../../src/context/AppContext";
import { AdminPage } from "../../src/admin/AdminShell";
import { adminStyles, EmptyRows, FailureState, LoadingState, Pill, RowCard, useAdminLoad } from "../../src/admin/AdminUI";
import type { AdminOfficer } from "../../src/admin/adminTypes";

const ROLE: Record<AdminOfficer["memberRole"], string> = { OFFICER: "Officer", SUPERVISOR: "Supervisor", ADMIN: "Administrator" };

// Members of the caller's organization(s) only. Workload counts, no location
// history or tracking; citizens never appear here.
export default function AdminOfficers() {
  const router = useRouter();
  const { admin } = useApp();
  const load = useAdminLoad(() => admin!.listOfficers(), "officers");

  return (
    <AdminPage title="Officers" subtitle="Members of your organization and their current workload" onRefresh={load.reload}>
      {load.phase === "loading" ? (
        <LoadingState />
      ) : load.phase === "failed" ? (
        <FailureState failure={load.failure} onRetry={load.reload} />
      ) : load.data.length === 0 ? (
        <EmptyRows title="No members" body="Your organization has no officer or supervisor memberships yet." />
      ) : (
        <View>
          {load.data.map((o) => {
            const content = (
              <>
                <View style={styles.colName}>
                  <Text style={adminStyles.cellStrong}>{o.displayName ?? "Unnamed member"}</Text>
                  <Text style={adminStyles.muted}>{o.organizationName}</Text>
                </View>
                <View style={styles.colTags}>
                  <Pill text={ROLE[o.memberRole] ?? o.memberRole} tone={o.memberRole === "OFFICER" ? "blue" : "neutral"} />
                  <Pill text={o.active ? "Active membership" : "Inactive membership"} tone={o.active ? "green" : "red"} />
                </View>
                <View style={styles.colNums}>
                  <Text style={adminStyles.cell}>{o.activeCases} active</Text>
                  <Text style={adminStyles.muted}>{o.completedThisMonth} completed this month</Text>
                </View>
              </>
            );
            // Officers / members with cases open the Cases list filtered to them.
            return o.memberRole === "OFFICER" || o.activeCases > 0 ? (
              <RowCard key={`${o.organizationName}-${o.userId}`} onPress={() => router.push({ pathname: "/admin/cases", params: { officer: o.userId } } as never)} label={`${o.displayName ?? "Member"}, ${o.activeCases} active cases`}>
                {content}
              </RowCard>
            ) : (
              <View key={`${o.organizationName}-${o.userId}`} style={styles.plain}>
                {content}
              </View>
            );
          })}
          <Text style={[adminStyles.muted, { marginTop: 8 }]}>
            Memberships are managed by ParkWatch administration tooling, not in this console. Locations of officers are not recorded or shown.
          </Text>
        </View>
      )}
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  colName: { flex: 1, minWidth: 180 },
  colTags: { gap: 4, width: 170 },
  colNums: { width: 190 },
  plain: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: "#E8ECE9", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8 },
});
