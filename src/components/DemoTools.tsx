import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../constants/colors";
import { radius } from "../constants/spacing";
import { useSession } from "../context/SessionContext";
import { useApp } from "../context/AppContext";
import { useReportDraft } from "../context/ReportContext";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * DEVELOPMENT/DEMO BUILDS ONLY. Renders nothing in production (no role
 * selector ships to real users). Lets a single phone show both sides of the
 * demo: switch citizen <-> officer, and reset to the known demo data.
 */
export function DemoTools() {
  const { role, devSwitchRole } = useSession();
  const { resetDemoData } = useApp();
  const { startNewReport } = useReportDraft();
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!__DEV__ || !devSwitchRole) return null;
  const other = role === "officer" ? "citizen" : "officer";

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <Ionicons name="construct-outline" size={15} color={colors.textSecondary} />
        <Text style={styles.title}>Demo tools</Text>
        <Text style={styles.badge}>DEV ONLY</Text>
      </View>
      <Pressable style={styles.row} onPress={() => devSwitchRole(other)} accessibilityRole="button">
        <Ionicons name="swap-horizontal" size={17} color={colors.greenDark} />
        <Text style={styles.rowLabel}>Switch to {other === "officer" ? "Officer" : "Citizen"} app</Text>
      </Pressable>
      <Pressable
        style={styles.row}
        onPress={() => {
          setMessage(null);
          setConfirmReset(true);
        }}
        accessibilityRole="button"
      >
        <Ionicons name="refresh" size={17} color={colors.greenDark} />
        <Text style={styles.rowLabel}>Reset demo data</Text>
      </Pressable>
      {message && <Text style={styles.message}>{message}</Text>}
      <ConfirmDialog
        visible={confirmReset}
        title="Reset demo data?"
        message="All reports, cases, inspections, wallet activity, notifications, vehicles and parking sessions return to the standard demo state. Anything created in this session is removed."
        confirmLabel="Reset"
        destructive
        busy={busy}
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          setBusy(true);
          void resetDemoData().then(() => {
            startNewReport(); // drop any half-finished draft too
            setBusy(false);
            setConfirmReset(false);
            setMessage("Demo data reset.");
          });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 20,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: 14,
    gap: 4,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  title: { fontWeight: "800", fontSize: 13.5, color: colors.textSecondary },
  badge: { marginLeft: "auto", fontSize: 10, fontWeight: "800", color: colors.textLight, letterSpacing: 0.5 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  rowLabel: { fontWeight: "700", fontSize: 14, color: colors.textPrimary },
  message: { fontSize: 12, color: colors.greenDark, fontWeight: "600" },
});
