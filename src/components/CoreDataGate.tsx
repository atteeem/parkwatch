import React, { useEffect } from "react";
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../constants/colors";
import { useAuth } from "../auth/AuthContext";
import { useApp } from "../context/AppContext";
import { describeDomainError } from "../presentation/errors";
import { GreenButton } from "./GreenButton";
import { Splash } from "./AreaGuard";
import { BOTTOM_NAV_HEIGHT } from "../constants/spacing";

/**
 * Server-backed mode only (a pass-through in the local demo):
 * - first load: loading screen; failure with no data: error screen + Try Again
 *   (never demo data instead);
 * - every screen change refreshes the data unless it is a few seconds old
 *   (plus app foreground and after each action; there is no polling);
 * - a failed background refresh keeps the last data and offers Retry.
 */
export function CoreDataGate({ children }: { children: React.ReactNode }) {
  const { dataSource, coreStatus, refreshCore, refreshCoreIfStale } = useApp();
  const { signOut } = useAuth();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const backend = dataSource === "BACKEND";

  useEffect(() => {
    if (backend) refreshCoreIfStale();
  }, [backend, pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!backend) return <>{children}</>;

  if (coreStatus.phase === "idle" || coreStatus.phase === "loading") return <Splash label="Loading your data…" />;

  if (coreStatus.phase === "error") {
    const message = coreStatus.error ? describeDomainError(coreStatus.error).message : "Something went wrong. Please try again.";
    return (
      <View style={styles.center} accessibilityRole="alert">
        <Ionicons name="cloud-offline-outline" size={40} color={colors.textSecondary} />
        <Text style={styles.title}>Couldn't load your data</Text>
        <Text style={styles.body}>{message}</Text>
        <GreenButton label="Try Again" onPress={() => void refreshCore()} style={{ alignSelf: "stretch", marginTop: 18 }} />
        <Pressable onPress={() => void signOut()} style={{ marginTop: 14 }} accessibilityRole="button">
          <Text style={styles.link}>Sign out</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {children}
      {coreStatus.error && (
        <View style={[styles.banner, { bottom: insets.bottom + BOTTOM_NAV_HEIGHT + 12 }]} accessibilityRole="alert">
          <Ionicons name="alert-circle" size={15} color="#B3261E" />
          <Text style={styles.bannerText}>Couldn't refresh. Showing earlier data.</Text>
          <Pressable onPress={() => void refreshCore()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Retry refresh">
            <Text style={styles.bannerAction}>{coreStatus.refreshing ? "Retrying…" : "Retry"}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/** Pull-to-refresh for list screens. Server-backed mode only (undefined in the local demo). */
export function useCoreRefreshControl(): React.ReactElement<React.ComponentProps<typeof RefreshControl>> | undefined {
  const { dataSource, coreStatus, refreshCore } = useApp();
  if (dataSource !== "BACKEND") return undefined;
  return <RefreshControl refreshing={coreStatus.refreshing} onRefresh={() => void refreshCore()} tintColor={colors.greenDark} colors={[colors.greenDark]} />;
}

/** Small inline loading line for detail screens that wait for fresh data. */
export function InlineLoading({ label }: { label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center", padding: 16 }}>
      <ActivityIndicator color={colors.greenDark} />
      <Text style={{ color: colors.textSecondary }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, backgroundColor: colors.background },
  title: { fontSize: 18, fontWeight: "800", marginTop: 12, color: colors.textPrimary },
  body: { fontSize: 13.5, color: colors.textSecondary, textAlign: "center", marginTop: 6, lineHeight: 19 },
  link: { color: colors.greenDark, fontWeight: "700" },
  banner: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.redLight,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  bannerText: { flex: 1, color: "#B3261E", fontSize: 12.5, fontWeight: "600" },
  bannerAction: { color: "#B3261E", fontWeight: "800", fontSize: 12.5 },
});

/**
 * Footer for a paged list: first-page loading, "Show more", and a page error
 * with Retry. Renders nothing for a complete list (always the local demo).
 */
export function ListFooter({
  list,
}: {
  list: { loaded: boolean; loading: boolean; hasMore: boolean; error: { code: string } | null; loadMore: () => void };
}) {
  if (list.loading) return <InlineLoading label={list.loaded ? "Loading more…" : "Loading…"} />;
  if (list.error) {
    return (
      <View style={{ alignItems: "center", padding: 12, gap: 8 }} accessibilityRole="alert">
        <Text style={{ color: "#B3261E", fontSize: 12.5, fontWeight: "600", textAlign: "center" }}>{describeDomainError(list.error).message}</Text>
        <GreenButton label="Retry" small variant="outline" onPress={list.loadMore} />
      </View>
    );
  }
  if (list.hasMore) return <GreenButton label="Show more" small variant="outline" onPress={list.loadMore} style={{ alignSelf: "center", marginVertical: 12 }} />;
  return null;
}

/** Empty states must wait for the first page: "nothing here" while loading would be false. */
export const listSettledEmpty = (list: { loaded: boolean; loading: boolean; items: unknown[] }) => list.loaded && !list.loading && list.items.length === 0;

/** Detail screen whose case/report is still being fetched for the first time (server mode). */
export function DetailLoading({ label = "Loading case…" }: { label?: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top + 40 }} accessibilityLabel={label}>
      <InlineLoading label={label} />
    </View>
  );
}
