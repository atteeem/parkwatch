import React from "react";
import { Modal, View, Text, Pressable, StyleSheet } from "react-native";
import { colors } from "../constants/colors";
import { radius } from "../constants/spacing";

/**
 * Confirmation dialog for irreversible officer decisions. Modal-based
 * (React Native's Alert does not render on web).
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  destructive,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityRole="alert">
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.row}>
            <Pressable style={[styles.btn, styles.cancel]} onPress={onCancel} disabled={busy}>
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, destructive ? styles.destructive : styles.confirm, busy && { opacity: 0.6 }]}
              onPress={onConfirm}
              disabled={busy}
            >
              <Text style={[styles.confirmLabel, destructive && { color: "#fff" }]}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: 24 },
  card: { width: "100%", maxWidth: 380, backgroundColor: colors.white, borderRadius: radius.card, padding: 20 },
  title: { fontSize: 17, fontWeight: "800", color: colors.textPrimary },
  message: { fontSize: 13.5, color: colors.textSecondary, marginTop: 8, lineHeight: 19 },
  error: { fontSize: 12.5, color: "#B3261E", fontWeight: "600", marginTop: 10 },
  row: { flexDirection: "row", gap: 10, marginTop: 18 },
  btn: { flex: 1, borderRadius: radius.button, paddingVertical: 12, alignItems: "center" },
  cancel: { backgroundColor: colors.backgroundSunk },
  cancelLabel: { fontWeight: "700", color: colors.textPrimary },
  confirm: { backgroundColor: colors.green },
  destructive: { backgroundColor: colors.red },
  confirmLabel: { fontWeight: "800", color: "#06210F" },
});
