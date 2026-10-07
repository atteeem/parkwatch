import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Redirect } from "expo-router";
import { colors } from "../constants/colors";
import { useSession } from "../context/SessionContext";
import { AppArea, guardArea } from "../navigation/roleGuard";

/** Shown while the session / server authorization is being resolved. */
export function Splash({ label = "Loading your account…" }: { label?: string }) {
  return (
    <View style={styles.splash} accessibilityLabel={label}>
      <Text style={styles.brand}>ParkWatch</Text>
      <ActivityIndicator color={colors.greenDark} style={{ marginTop: 16 }} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

/**
 * Route-group guard. In BACKEND mode the decision uses only the server-resolved
 * access; in LOCAL_DEMO mode the dev role. Deep links into a forbidden area are
 * redirected to the session's own home (or to sign-in).
 */
export function AreaGuard({ area, children }: { area: AppArea; children: React.ReactNode }) {
  const { view } = useSession();
  const d = guardArea(view, area);
  if (d.type === "loading") return <Splash />;
  if (d.type === "redirect") return <Redirect href={d.to as never} />;
  return <>{children}</>;
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background, padding: 24 },
  brand: { fontSize: 28, fontWeight: "800", color: colors.greenDark },
  label: { marginTop: 10, color: colors.textSecondary, fontSize: 13 },
});
