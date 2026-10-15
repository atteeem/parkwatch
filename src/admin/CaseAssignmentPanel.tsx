// Case detail: assigned officer + Assign / Reassign / Return to queue (T9.2).
// Every change is confirmed, sent with the version this screen showed (a stale
// screen is refused by the server and reloaded) and audited on the server.

import React, { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../constants/colors";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { GreenButton } from "../components/GreenButton";
import { describeDomainError } from "../presentation/errors";
import { adminStyles, KeyValue, Pill, Section, useAdminLoad } from "./AdminUI";
import { ATTENTION_STATUS_TEXT, formatElapsed, OpenStatus } from "./attention";
import { assignmentOptions, confirmCopy, officerLabel, pickerOfficers } from "./assignment";
import type { AdminApi, AdminAssignableOfficer, AdminCaseDetail } from "./adminTypes";

type Pending = { kind: "assign" | "reassign"; officer: AdminAssignableOfficer } | { kind: "return" };

export function CaseAssignmentPanel({ d, admin, onChanged }: { d: AdminCaseDetail; admin: AdminApi; onChanged: () => Promise<void> | void }) {
  const opts = assignmentOptions(d.status);
  const [picking, setPicking] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const officers = useAdminLoad(() => admin.listAssignableOfficers(d.id), `assignable-${d.id}-${d.assignmentVersion}`);
  const choices = officers.phase === "ready" && officers.data ? pickerOfficers(officers.data) : [];
  const canChange = opts.assign || opts.reassign;

  // A second tap before the dialog re-renders as busy is ignored (the server is idempotent too).
  const inFlight = useRef(false);
  const run = async () => {
    if (!pending || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const r = pending.kind === "return" ? await admin.unassignCase(d.id, d.assignmentVersion) : await admin.assignCase(d.id, pending.officer.userId, d.assignmentVersion);
    inFlight.current = false;
    setBusy(false);
    if (!r.ok) {
      setError(describeDomainError(r.error).message);
      // Stale / started / completed: show the case as it is now.
      if (["STALE_ASSIGNMENT", "NOT_ASSIGNABLE", "ALREADY_COMPLETED"].includes(r.error.code)) void onChanged();
      return;
    }
    setPending(null);
    setPicking(false);
    setNotice(pending.kind === "return" ? "Returned to the queue." : `Assigned to ${officerLabel(pending.officer)}.`);
    await onChanged();
  };

  // Keep the last wording while the dialog fades out (it would otherwise flash empty).
  const lastCopy = useRef<ReturnType<typeof confirmCopy> | null>(null);
  if (pending) lastCopy.current = confirmCopy(pending.kind, pending.kind === "return" ? undefined : officerLabel(pending.officer), d.assignedOfficerName);
  const copy = lastCopy.current;
  const attention = d.attention;

  return (
    <Section title="Assignment" style={styles.section}>
      <KeyValue k="Assigned officer" v={d.assignedOfficerName ?? (d.status === "NEW" ? "Unassigned" : "—")} />
      {attention.needsAttention && attention.statusSince && d.status !== "COMPLETED" ? (
        <View style={styles.attention} accessibilityRole="text">
          <Pill text="Needs attention" tone="amber" />
          <Text style={adminStyles.muted}>
            {`${formatElapsed(attention.statusSince, new Date())} ${ATTENTION_STATUS_TEXT[d.status as OpenStatus]}`}
            {attention.thresholdMinutes ? ` (usual limit ${attention.thresholdMinutes} min)` : ""}
          </Text>
        </View>
      ) : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {error && !pending ? <Text style={styles.error}>{error}</Text> : null}

      {opts.lockedReason ? (
        <Text style={adminStyles.muted}>{opts.lockedReason}</Text>
      ) : (
        <View style={styles.actions}>
          {canChange ? (
            <GreenButton
              small
              label={opts.assign ? "Assign" : "Reassign"}
              icon="person-add"
              trailingIcon={null}
              variant={picking ? "gray" : "solid"}
              onPress={() => {
                setNotice(null);
                setError(null);
                setPicking((p) => !p);
              }}
            />
          ) : null}
          {opts.returnToQueue ? (
            <GreenButton small label="Return to queue" variant="outline" trailingIcon={null} onPress={() => (setNotice(null), setError(null), setPending({ kind: "return" }))} />
          ) : null}
        </View>
      )}

      {picking && canChange ? (
        <View style={styles.picker} accessibilityLabel="Choose an officer">
          <Text style={styles.pickerTitle}>Active officers of this organization</Text>
          {officers.phase === "loading" ? <Text style={adminStyles.muted}>Loading officers…</Text> : null}
          {officers.phase === "failed" ? <Text style={styles.error}>Couldn't load officers. Try again.</Text> : null}
          {officers.phase === "ready" && choices.length === 0 ? <Text style={adminStyles.muted}>No other active officers in this organization.</Text> : null}
          {choices.map((o) => (
            <Pressable
              key={o.userId}
              onPress={() => setPending({ kind: opts.assign ? "assign" : "reassign", officer: o })}
              style={({ pressed }) => [styles.officer, pressed && { backgroundColor: "#F4F7F5" }]}
              accessibilityRole="button"
              accessibilityLabel={`${officerLabel(o)}, ${o.activeCases} active cases`}
            >
              <Ionicons name="person-circle" size={22} color={colors.textSecondary} />
              <Text style={[adminStyles.cell, { flex: 1 }]}>{officerLabel(o)}</Text>
              <Text style={adminStyles.muted}>{o.activeCases === 1 ? "1 active case" : `${o.activeCases} active cases`}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <ConfirmDialog
        visible={!!pending && !!copy}
        title={copy?.title ?? ""}
        message={copy?.message ?? ""}
        confirmLabel={copy?.confirm ?? ""}
        destructive={pending?.kind === "return"}
        busy={busy}
        error={pending ? error : null}
        onConfirm={() => void run()}
        onCancel={() => {
          setPending(null);
          setError(null);
        }}
      />
    </Section>
  );
}

const styles = StyleSheet.create({
  section: { flexGrow: 1, flexBasis: 340 },
  attention: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 6 },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 10 },
  picker: { marginTop: 10, borderTopWidth: 1, borderTopColor: colors.borderLight, paddingTop: 8 },
  pickerTitle: { fontSize: 12, fontWeight: "800", color: colors.textSecondary, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 },
  officer: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 6, borderRadius: 8 },
  notice: { marginTop: 8, color: colors.greenDark, fontWeight: "700" },
  error: { marginTop: 8, color: "#B3261E", fontWeight: "700" },
});
