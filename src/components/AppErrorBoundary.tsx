// Top-level fallback for an unexpected render error (Expo Router renders the
// root layout's ErrorBoundary in place of the crashed route tree). Friendly
// copy, a Try again action and a way home; never a stack trace or error text
// on screen. Development builds still log the error to the console; release
// builds log only the error's name (no message: it could contain user data).

import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../constants/colors";

export const APP_ERROR_COPY = {
  title: "Something went wrong",
  body: "ParkWatch hit an unexpected problem. Your sent reports and cases are safe on the server. Try again, or go back to the start.",
  retry: "Try again",
  home: "Back to start",
} as const;

/** Only the error's kind leaves the screen (never message, stack, ids or evidence). */
export function describeForLog(error: unknown): string {
  return error instanceof Error ? error.name || "Error" : typeof error;
}

export function AppErrorFallback({ error, retry, onHome }: { error: unknown; retry: () => void | Promise<void>; onHome?: () => void }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (__DEV__) console.error("[ParkWatch] unexpected error", error);
    else console.warn(`[ParkWatch] unexpected error (${describeForLog(error)})`);
  }, [error]);
  return (
    <View style={styles.root} accessibilityRole="alert" testID="app-error-boundary">
      <View style={styles.icon}>
        <Ionicons name="alert-circle" size={36} color={colors.red} />
      </View>
      <Text style={styles.title}>{APP_ERROR_COPY.title}</Text>
      <Text style={styles.body}>{APP_ERROR_COPY.body}</Text>
      <Text
        style={[styles.primary, busy && { opacity: 0.6 }]}
        accessibilityRole="button"
        accessibilityLabel={APP_ERROR_COPY.retry}
        onPress={async () => {
          if (busy) return;
          setBusy(true);
          try {
            await retry();
          } finally {
            setBusy(false);
          }
        }}
      >
        {APP_ERROR_COPY.retry}
      </Text>
      {onHome ? (
        <Text style={styles.secondary} accessibilityRole="button" accessibilityLabel={APP_ERROR_COPY.home} onPress={onHome}>
          {APP_ERROR_COPY.home}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, backgroundColor: colors.background, gap: 12 },
  icon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.redLight, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  title: { fontSize: 22, fontWeight: "800", color: colors.textPrimary, textAlign: "center" },
  body: { fontSize: 15, lineHeight: 21, color: colors.textSecondary, textAlign: "center", maxWidth: 360 },
  primary: {
    marginTop: 10,
    minWidth: 200,
    textAlign: "center",
    overflow: "hidden",
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 14,
    backgroundColor: colors.green,
    color: colors.black,
    fontWeight: "800",
    fontSize: 16,
  },
  secondary: { paddingVertical: 12, paddingHorizontal: 16, color: colors.textSecondary, fontWeight: "700", fontSize: 15 },
});
