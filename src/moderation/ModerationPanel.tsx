// Staff moderation panel for the reporter of one case (officer app and the
// operations console). Server-backed only. The server checks every rule and
// the caller's authority; this panel only explains and confirms.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { colors } from "../constants/colors";
import { radius } from "../constants/spacing";
import { describeDomainError } from "../presentation/errors";
import {
  formatModerationDate,
  isRestricted,
  MAX_STRIKES,
  MODERATION_REASONS,
  ModerationApi,
  ModerationHistoryEntry,
  ModerationReason,
  newModerationRequestId,
  REASON_LABEL,
  restrictConfirmCopy,
  restrictInputError,
  revokeConfirmCopy,
  revokeInputError,
  STAFF_STATUS_LABEL,
  StaffModeration,
  strikeText,
} from "./moderationTypes";

// The wording is fixed when the sheet opens, so the sheet still says what was
// confirmed while it fades out over the updated state.
type SheetCopy = { title: string; body: string; third: boolean; confirmLabel: string };
type Sheet = ({ kind: "restrict"; requestId: string } | { kind: "revoke"; requestId: string; actionId: string }) & { copy: SheetCopy };

export const MODERATION_PANEL_COPY = {
  heading: "Reporter moderation",
  restrict: "Restrict reporting for 30 days",
  restrictThird: "Restrict reporting (3rd strike)",
  lift: "Lift restriction",
  restore: "Restore reporting access",
  confirmRestrict: "Restrict reporting",
  confirmLift: "Lift restriction",
  confirmRestore: "Restore access",
  cancel: "Cancel",
};

const ROLE_LABEL = { OFFICER: "Officer", SUPERVISOR: "Supervisor", ADMIN: "Administrator" } as const;

export function ModerationPanel({ api, caseId }: { api: ModerationApi; caseId: string }) {
  const [data, setData] = useState<StaffModeration | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [reason, setReason] = useState<ModerationReason | null>(null);
  const [note, setNote] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const lastSheet = useRef<Sheet | null>(null);
  if (sheet) lastSheet.current = sheet;
  const shown = sheet ?? lastSheet.current;

  const load = useCallback(async () => {
    setLoading(true);
    const r = await api.getForCase(caseId);
    if (!mounted.current) return;
    setLoading(false);
    if (r.ok) {
      setData(r.value);
      setLoadError(null);
    } else setLoadError(describeDomainError(r.error).message);
  }, [api, caseId]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const open = (s: Sheet) => {
    setSheet(s);
    setReason(null);
    setNote("");
    setInputError(null);
  };
  const close = () => {
    if (!busy) setSheet(null);
  };

  const confirm = async () => {
    if (!sheet || inFlight.current) return; // double tap / repeated press
    const err = sheet.kind === "restrict" ? restrictInputError(reason, note) : revokeInputError(note);
    setInputError(err);
    if (err) return;
    inFlight.current = true;
    setBusy(true);
    // The request id was fixed when the sheet opened: a retry of THIS confirmation is idempotent server-side.
    const r =
      sheet.kind === "restrict"
        ? await api.restrict(caseId, reason!, note.trim() || null, sheet.requestId)
        : await api.revoke(caseId, sheet.actionId, note.trim(), sheet.requestId);
    inFlight.current = false;
    if (!mounted.current) return;
    setBusy(false);
    if (r.ok) {
      setData(r.value);
      setSheet(null);
      return;
    }
    setInputError(describeDomainError(r.error).message);
    if (r.error.code === "ALREADY_RESTRICTED" || r.error.code === "NOT_ACTIVE") void load();
  };

  if (loading && !data) {
    return (
      <View style={styles.card}>
        <Text style={styles.heading}>{MODERATION_PANEL_COPY.heading}</Text>
        <ActivityIndicator style={{ marginTop: 10 }} />
      </View>
    );
  }
  if (!data) {
    return (
      <View style={styles.card}>
        <Text style={styles.heading}>{MODERATION_PANEL_COPY.heading}</Text>
        <Text style={styles.muted}>{loadError ?? "Moderation status is not available."}</Text>
        <Pressable onPress={() => void load()} accessibilityRole="button" style={styles.linkBtn}>
          <Text style={styles.link}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const restricted = isRestricted(data);
  const indefinite = data.status === "INDEFINITELY_RESTRICTED";
  const restrictCopy = (): SheetCopy => {
    const c = restrictConfirmCopy(data);
    return { title: c.title, body: c.body, third: c.third, confirmLabel: MODERATION_PANEL_COPY.confirmRestrict };
  };
  const revokeCopy = (): SheetCopy => {
    const c = revokeConfirmCopy(data);
    return { title: c.title, body: c.body, third: false, confirmLabel: indefinite ? MODERATION_PANEL_COPY.confirmRestore : MODERATION_PANEL_COPY.confirmLift };
  };
  const restricting = shown?.kind === "restrict";
  const third = !!shown?.copy.third;

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{MODERATION_PANEL_COPY.heading}</Text>
      <Text style={styles.ref}>Reporter {data.citizenRef}</Text>
      <View style={[styles.statusPill, restricted ? (indefinite ? styles.pillRed : styles.pillAmber) : styles.pillGreen]}>
        <Text style={styles.statusText}>{STAFF_STATUS_LABEL[data.status]}</Text>
      </View>
      {data.status === "TEMPORARILY_RESTRICTED" ? <Text style={styles.line}>Until {formatModerationDate(data.restrictedUntil)}</Text> : null}
      <Text style={styles.line} accessibilityLabel={`Strikes ${data.strikes} of ${MAX_STRIKES}`}>
        Strikes {data.strikes}/{MAX_STRIKES}
        {data.lifetimeStrikes > data.strikes ? `  ·  ${data.lifetimeStrikes} lifetime` : ""}
      </Text>

      <View style={styles.actions}>
        {!restricted ? (
          <Pressable
            style={[styles.btn, data.strikes + 1 >= MAX_STRIKES ? styles.btnDanger : styles.btnWarn]}
            onPress={() => open({ kind: "restrict", requestId: newModerationRequestId(), copy: restrictCopy() })}
            accessibilityRole="button"
          >
            <Text style={styles.btnText}>{data.strikes + 1 >= MAX_STRIKES ? MODERATION_PANEL_COPY.restrictThird : MODERATION_PANEL_COPY.restrict}</Text>
          </Pressable>
        ) : data.activeActionId ? (
          <Pressable style={[styles.btn, styles.btnNeutral]} onPress={() => open({ kind: "revoke", requestId: newModerationRequestId(), actionId: data.activeActionId!, copy: revokeCopy() })} accessibilityRole="button">
            <Text style={[styles.btnText, { color: colors.textPrimary }]}>{indefinite ? MODERATION_PANEL_COPY.restore : MODERATION_PANEL_COPY.lift}</Text>
          </Pressable>
        ) : null}
      </View>

      <Text style={styles.subheading}>History</Text>
      {data.history.length === 0 ? <Text style={styles.muted}>No moderation actions.</Text> : data.history.map((h) => <HistoryRow key={h.id} h={h} />)}

      <Modal visible={!!sheet} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>{shown?.copy.title}</Text>
              <Text style={[styles.sheetBody, third && styles.sheetBodyDanger]} accessibilityRole={third ? "alert" : undefined}>
                {shown?.copy.body}
              </Text>
              {restricting ? (
                <>
                  <Text style={styles.label}>Reason</Text>
                  <View style={styles.reasons}>
                    {MODERATION_REASONS.map((r) => (
                      <Pressable
                        key={r}
                        onPress={() => setReason(r)}
                        style={[styles.reason, reason === r && styles.reasonOn]}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: reason === r }}
                        accessibilityLabel={REASON_LABEL[r]}
                      >
                        <Text style={[styles.reasonText, reason === r && styles.reasonTextOn]}>{REASON_LABEL[r]}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.label}>{reason === "OTHER" ? "Note (required)" : "Internal note (optional)"}</Text>
                </>
              ) : (
                <Text style={styles.label}>Reason for lifting (required)</Text>
              )}
              <TextInput
                style={styles.input}
                value={note}
                onChangeText={setNote}
                placeholder={restricting ? "Visible to staff only" : "e.g. Reviewed: the reports were valid"}
                placeholderTextColor={colors.textLight}
                multiline
                maxLength={500}
                accessibilityLabel={restricting ? "Moderation note" : "Reason for lifting the restriction"}
              />
              {restricting ? <Text style={styles.hint}>Notes are visible to staff only, never to the user.</Text> : null}
              {inputError ? (
                <Text style={styles.error} accessibilityRole="alert">
                  {inputError}
                </Text>
              ) : null}
              <View style={styles.sheetButtons}>
                <Pressable style={[styles.btn, styles.btnNeutral, { flex: 1 }]} onPress={close} disabled={busy} accessibilityRole="button">
                  <Text style={[styles.btnText, { color: colors.textPrimary }]}>{MODERATION_PANEL_COPY.cancel}</Text>
                </Pressable>
                <Pressable
                  style={[styles.btn, restricting ? styles.btnDanger : styles.btnGreen, { flex: 1 }, busy && { opacity: 0.6 }]}
                  onPress={() => void confirm()}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy, busy }}
                >
                  {busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.btnText}>
                      {shown?.copy.confirmLabel}
                    </Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function HistoryRow({ h }: { h: ModerationHistoryEntry }) {
  const who = h.actorName ? `${h.actorName} (${ROLE_LABEL[h.actorRole]})` : h.sameOrganization ? ROLE_LABEL[h.actorRole] : `${ROLE_LABEL[h.actorRole]}, another organization`;
  const title =
    h.type === "RESTRICTION_REVOKED"
      ? "Restriction lifted"
      : h.indefinite
        ? `Indefinite restriction (strike ${strikeText(h.strikeInCycle ?? 3)})`
        : `30-day restriction (strike ${strikeText(h.strikeInCycle ?? 1)})`;
  return (
    <View style={styles.history}>
      <Text style={styles.historyTitle}>{title}</Text>
      <Text style={styles.historyMeta}>
        {formatModerationDate(h.createdAt)} · {who}
        {h.lifetimeStrike && h.cycle > 1 ? ` · cycle ${h.cycle}, lifetime strike ${h.lifetimeStrike}` : ""}
      </Text>
      {h.reason ? <Text style={styles.historyLine}>Reason: {REASON_LABEL[h.reason]}</Text> : null}
      {h.internalNote ? <Text style={styles.historyLine}>Note: {h.internalNote}</Text> : null}
      {h.type === "RESTRICTION_ISSUED" && !h.indefinite && h.expiresAt ? (
        <Text style={styles.historyLine}>
          {h.revokedAt ? `Lifted ${formatModerationDate(h.revokedAt)}` : new Date(h.expiresAt).getTime() < Date.now() ? `Ended ${formatModerationDate(h.expiresAt)}` : `Until ${formatModerationDate(h.expiresAt)}`}
        </Text>
      ) : null}
      {h.type === "RESTRICTION_ISSUED" && h.indefinite && h.revokedAt ? <Text style={styles.historyLine}>Access restored {formatModerationDate(h.revokedAt)}</Text> : null}
      {h.revokeReason ? <Text style={styles.historyLine}>Reason for lifting: {h.revokeReason}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: radius.card, padding: 16, borderWidth: 1, borderColor: colors.borderLight },
  heading: { fontSize: 15, fontWeight: "800", color: colors.textPrimary },
  subheading: { fontSize: 13, fontWeight: "800", color: colors.textSecondary, marginTop: 16, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.4 },
  ref: { fontSize: 12.5, color: colors.textSecondary, marginTop: 2 },
  statusPill: { alignSelf: "flex-start", borderRadius: radius.chip, paddingHorizontal: 10, paddingVertical: 4, marginTop: 10 },
  pillGreen: { backgroundColor: colors.greenLight },
  pillAmber: { backgroundColor: colors.amberLight },
  pillRed: { backgroundColor: colors.redLight },
  statusText: { fontSize: 12.5, fontWeight: "700", color: colors.textPrimary },
  line: { fontSize: 13.5, color: colors.textPrimary, marginTop: 6 },
  muted: { fontSize: 13, color: colors.textSecondary, marginTop: 6 },
  actions: { flexDirection: "row", marginTop: 12 },
  btn: { borderRadius: radius.button, paddingVertical: 11, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  btnWarn: { backgroundColor: colors.amber },
  btnDanger: { backgroundColor: colors.red },
  btnGreen: { backgroundColor: colors.greenDark },
  btnNeutral: { backgroundColor: colors.backgroundSunk, borderWidth: 1, borderColor: colors.border },
  btnText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  linkBtn: { marginTop: 8 },
  link: { color: colors.greenDark, fontWeight: "700" },
  history: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.borderLight },
  historyTitle: { fontSize: 13.5, fontWeight: "700", color: colors.textPrimary },
  historyMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  historyLine: { fontSize: 12.5, color: colors.textPrimary, marginTop: 2 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 20 },
  sheet: { backgroundColor: colors.white, borderRadius: radius.card, padding: 18, maxHeight: "90%" },
  sheetTitle: { fontSize: 17, fontWeight: "800", color: colors.textPrimary },
  sheetBody: { fontSize: 14, color: colors.textSecondary, marginTop: 8, lineHeight: 20 },
  sheetBodyDanger: { color: colors.red, fontWeight: "700" },
  label: { fontSize: 13, fontWeight: "800", color: colors.textPrimary, marginTop: 14, marginBottom: 6 },
  reasons: { gap: 6 },
  reason: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.button, paddingVertical: 9, paddingHorizontal: 12 },
  reasonOn: { borderColor: colors.greenDark, backgroundColor: colors.greenLight },
  reasonText: { fontSize: 13.5, color: colors.textPrimary },
  reasonTextOn: { fontWeight: "700" },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 10, minHeight: 64, fontSize: 14, color: colors.textPrimary, textAlignVertical: "top" },
  hint: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  error: { color: colors.red, fontSize: 13, fontWeight: "600", marginTop: 8 },
  sheetButtons: { flexDirection: "row", gap: 10, marginTop: 16 },
});
