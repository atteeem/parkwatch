import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { usePathname, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../constants/colors";
import { radius } from "../constants/spacing";
import { useApp } from "../context/AppContext";
import { SignOutRow } from "../components/SignOutRow";
import { DemoTools } from "../components/DemoTools";
import { useAdminLoad } from "./AdminUI";
import { activeAdminNav, ADMIN_NAV } from "./adminNav";

export { ADMIN_NAV, activeAdminNav };

export const WIDE_BREAKPOINT = 900;

/** Console frame: navigation + organization context. Content is read-only oversight. */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;
  const pathname = usePathname();
  const router = useRouter();
  const { admin, dataSource } = useApp();
  const who = useAdminLoad(() => (admin ? admin.whoami() : Promise.resolve({ ok: false, error: { code: "FORBIDDEN", message: "FORBIDDEN" } } as const)), admin ? "who" : "none");
  const active = activeAdminNav(pathname);
  const org = who.phase === "ready" ? who.data.organizations.map((o) => o.name).join(", ") : "";
  const role = who.phase === "ready" ? (who.data.role === "ADMIN" ? "Administrator" : "Supervisor") : "";
  const go = (path: string) => {
    if (path !== pathname) router.replace(path as never);
  };

  const nav = ADMIN_NAV.map((n) => {
    const on = n.path === active;
    return (
      <Pressable
        key={n.path}
        onPress={() => go(n.path)}
        style={[wide ? styles.sideItem : styles.topItem, on && (wide ? styles.sideItemOn : styles.topItemOn)]}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        accessibilityLabel={n.label}
      >
        <Ionicons name={n.icon} size={17} color={on ? (wide ? colors.greenDark : "#fff") : colors.textSecondary} />
        <Text style={[styles.navText, on && { color: wide ? colors.greenDark : "#fff" }]}>{n.label}</Text>
      </Pressable>
    );
  });

  const brand = (
    <View>
      <Text style={styles.brand}>ParkWatch</Text>
      <Text style={styles.brandSub}>Operations console</Text>
      {org ? <Text style={styles.org} numberOfLines={2}>{org}</Text> : null}
      <View style={{ flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
        {role ? <Text style={styles.badge}>{role}</Text> : null}
        <Text style={[styles.badge, styles.badgeRo]}>Read-only</Text>
        {dataSource === "LOCAL_DEMO" ? <Text style={[styles.badge, styles.badgeDemo]}>Local demo</Text> : null}
      </View>
    </View>
  );

  if (wide) {
    return (
      <SafeAreaView style={[styles.root, { flexDirection: "row" }]} edges={["top", "bottom"]}>
        <View style={styles.sidebar}>
          {brand}
          <View style={{ marginTop: 18, gap: 2 }} accessibilityRole="tablist">
            {nav}
          </View>
          <View style={{ flex: 1 }} />
          <View style={styles.signOut}>
            <SignOutRow />
          </View>
          <DemoTools />
        </View>
        <View style={{ flex: 1 }}>{children}</View>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.topBar}>{brand}</View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.topNav} style={{ flexGrow: 0 }} accessibilityRole="tablist">
        {nav}
      </ScrollView>
      <View style={{ flex: 1 }}>{children}</View>
    </SafeAreaView>
  );
}

/** One console page: title, optional back link, scrollable content (max width for desktop). */
export function AdminPage({
  title,
  subtitle,
  back,
  children,
  onRefresh,
  refreshing = false,
  footer,
}: {
  title: string;
  subtitle?: string;
  back?: { label: string; onPress: () => void };
  children: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  footer?: React.ReactNode;
}) {
  const { width } = useWindowDimensions();
  const showDemo = width < WIDE_BREAKPOINT;
  return (
    <ScrollView
      contentContainerStyle={styles.page}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.pageInner}>
        {back ? (
          <Pressable onPress={back.onPress} style={styles.back} accessibilityRole="link" accessibilityLabel={back.label} hitSlop={8}>
            <Ionicons name="chevron-back" size={16} color={colors.greenDark} />
            <Text style={styles.backText}>{back.label}</Text>
          </Pressable>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          {onRefresh ? (
            <Pressable onPress={onRefresh} style={styles.refresh} accessibilityRole="button" accessibilityLabel="Refresh" hitSlop={6}>
              <Ionicons name="refresh" size={16} color={colors.greenDark} />
              <Text style={styles.backText}>Refresh</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={{ marginTop: 16, gap: 14 }}>{children}</View>
        {footer}
        {showDemo ? (
          <View style={{ marginTop: 20 }}>
            <SignOutRow />
            <DemoTools />
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  sidebar: { width: 236, borderRightWidth: 1, borderRightColor: colors.border, backgroundColor: colors.white, padding: 18 },
  brand: { fontSize: 20, fontWeight: "800", color: colors.greenDark },
  brandSub: { fontSize: 12.5, fontWeight: "700", color: colors.textSecondary },
  org: { fontSize: 12, color: colors.textPrimary, marginTop: 8, fontWeight: "600" },
  badge: { fontSize: 10.5, fontWeight: "800", color: colors.greenDark, backgroundColor: colors.greenLight, borderRadius: radius.chip, paddingHorizontal: 7, paddingVertical: 2, overflow: "hidden" },
  badgeRo: { color: colors.textSecondary, backgroundColor: "#EEF1EF" },
  badgeDemo: { color: "#8A5A00", backgroundColor: "#FFF3D6" },
  sideItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, paddingHorizontal: 10, borderRadius: radius.button },
  sideItemOn: { backgroundColor: colors.greenLight },
  navText: { fontSize: 14, fontWeight: "700", color: colors.textSecondary },
  signOut: { borderTopWidth: 1, borderTopColor: colors.borderLight, marginTop: 10 },
  topBar: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  topNav: { paddingHorizontal: 12, paddingBottom: 8, gap: 6 },
  topItem: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 7, paddingHorizontal: 12, borderRadius: radius.chip, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  topItemOn: { backgroundColor: colors.greenDark, borderColor: colors.greenDark },
  page: { padding: 20, paddingBottom: 48 },
  pageInner: { width: "100%", maxWidth: 1200, alignSelf: "center" },
  back: { flexDirection: "row", alignItems: "center", gap: 2, marginBottom: 8, alignSelf: "flex-start" },
  backText: { color: colors.greenDark, fontWeight: "800", fontSize: 13 },
  title: { fontSize: 24, fontWeight: "800", color: colors.textPrimary },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  refresh: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: colors.border, borderRadius: radius.chip, paddingHorizontal: 10, paddingVertical: 6 },
});
