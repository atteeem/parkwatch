import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { colors } from "../../src/constants/colors";
import { typography } from "../../src/constants/typography";
import { radius, shadow, BOTTOM_NAV_HEIGHT } from "../../src/constants/spacing";
import { UserBottomNav } from "../../src/components/UserBottomNav";
import { StatCard } from "../../src/components/StatCard";
import { VehicleThumbnail } from "../../src/components/VehicleThumbnail";
import { usePagedList, useApp } from "../../src/context/AppContext";
import { ConfirmDialog } from "../../src/components/ConfirmDialog";
import { useCoreRefreshControl } from "../../src/components/CoreDataGate";
import { useAuth } from "../../src/auth/AuthContext";
import { displayIdentity } from "../../src/auth/identity";
import { HOME_REPORT_SHORTCUTS } from "../../src/presentation/citizenViews";
import { useReportDraft } from "../../src/context/ReportContext";
import { LiveMap } from "../../src/components/map/LiveMap";
import { useForegroundLocation } from "../../src/location/useForegroundLocation";
import { citizenReportMarkers } from "../../src/map/mapLogic";
import { violationLabel } from "../../src/data/types";

export default function UserHome() {
  const router = useRouter();
  const { getEarnings, citizenSummary } = useApp();
  const refreshControl = useCoreRefreshControl();
  // Counts come from the server in backend mode (all reports, not one loaded page).
  const unread = citizenSummary.unread;
  const me = displayIdentity(useAuth().state, "citizen");
  const { startNewReport, unsentDraft, resumeDraft, discardDraft } = useReportDraft();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const recent = usePagedList({ kind: "citizenReports", tab: "all" });
  // Reads a position only if permission was already granted; no prompt, no watch.
  const location = useForegroundLocation();
  const latest = recent.items.slice(0, 3);
  const week = { submitted: citizenSummary.weekSubmitted, verified: citizenSummary.weekVerified };
  const weekEarned = getEarnings("THIS_WEEK").totalText.replace(/\.00$/, "");

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView refreshControl={refreshControl} contentContainerStyle={{ paddingBottom: BOTTOM_NAV_HEIGHT + 20 }}>
        <View style={[styles.headerBlock, { flexDirection: "row", alignItems: "flex-start" }]}>
          <View style={{ flex: 1 }}>
            <Text style={typography.screenTitle}>Hello, {me.firstName}!</Text>
            <Text style={typography.screenSubtitle}>
              Together we make traffic flow better and safer.
            </Text>
          </View>
          <Pressable
            style={styles.bellBtn}
            onPress={() => router.push("/user/notifications")}
            accessibilityRole="button"
            accessibilityLabel={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          >
            <Ionicons name="notifications" size={18} color={colors.textPrimary} />
            {unread > 0 && (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeLabel}>{unread}</Text>
              </View>
            )}
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 14 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}>
          <Pressable style={styles.shortcut} onPress={() => router.replace(HOME_REPORT_SHORTCUTS.activeReports)}>
            <Ionicons name="heart-outline" size={16} color={colors.textPrimary} />
            <Text style={styles.shortcutLabel}>Active Reports</Text>
          </Pressable>
          <Pressable style={styles.shortcut} onPress={() => router.replace(HOME_REPORT_SHORTCUTS.reportHistory)}>
            <Ionicons name="time-outline" size={16} color={colors.textPrimary} />
            <Text style={styles.shortcutLabel}>Report History</Text>
          </Pressable>
        </ScrollView>

        {unsentDraft && (
          <View style={styles.section}>
            <View style={styles.unsentCard} accessibilityRole="summary">
              <Ionicons name="document-text-outline" size={20} color={colors.amber} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.unsentTitle}>Unfinished report</Text>
                <Text style={styles.unsentBody}>This report has not been sent yet. It is saved on this phone.</Text>
                <View style={{ flexDirection: "row", gap: 16, marginTop: 10 }}>
                  <Pressable accessibilityRole="button" onPress={() => router.push(resumeDraft())}>
                    <Text style={styles.unsentAction}>Continue unfinished report</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => setConfirmDiscard(true)}>
                    <Text style={[styles.unsentAction, { color: colors.red }]}>Discard</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Pressable
            onPress={() => {
              startNewReport();
              router.push("/user/report/photos");
            }}
          >
            <LinearGradient
              colors={[colors.green, colors.greenDark]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.banner}
            >
              <View style={styles.bannerIconWrap}>
                <Ionicons name="camera" size={22} color={colors.greenDark} />
              </View>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={styles.bannerTitle}>Report Parking Issue</Text>
                <Text style={styles.bannerBody}>
                  Help keep streets safe and accessible. Earn rewards for verified parking reports.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#06210F" />
            </LinearGradient>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Pressable style={styles.mapCard} onPress={() => router.push("/user/map")}>
            {/* Lightweight preview of the same live map: no gestures, no live watch, never prompts. */}
            <LiveMap
              style={styles.mapPreview}
              interactive={false}
              markers={citizenReportMarkers(recent.items, "all")}
              userFix={location.permission === "granted" ? location.fix : undefined}
              following={false}
            />
            <View style={styles.mapStrip}>
              <View style={{ flex: 1 }}>
                <Text style={styles.mapStripTitle}>View your reports on the map</Text>
                <Text style={styles.mapStripBody}>See your reports and their status on the map</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textLight} />
            </View>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={typography.sectionHeading}>Statistics</Text>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <StatCard icon="car" iconBg={colors.blueLight} iconColor={colors.blue} value={String(week.submitted)} label="Reports made" sublabel="This week" />
            <StatCard icon="checkmark-circle" iconBg={colors.greenLight} iconColor={colors.greenDark} value={String(week.verified)} label="Accepted" sublabel="This week" />
            <StatCard icon="logo-euro" iconBg={colors.amberLight} iconColor="#B47A00" value={weekEarned} label="Earned Rewards" sublabel="This week" />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={typography.sectionHeading}>Latest reports</Text>
          <View style={{ marginTop: 10, backgroundColor: colors.white, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, ...shadow.card }}>
            {latest.map((r, i) => (
              <Pressable
                key={r.id}
                onPress={() => router.push({ pathname: "/user/report/report-overview", params: { id: r.id } })}
                style={[styles.reportRow, i < latest.length - 1 && styles.reportRowDivider]}
              >
                <VehicleThumbnail uri={r.images[0]} />
                <View style={{ marginLeft: 12, flex: 1 }}>
                  <Text style={styles.reportPlate}>{r.plate}</Text>
                  <Text style={styles.reportMeta} numberOfLines={1}>
                    <Ionicons name="location" size={11} /> {r.location}
                  </Text>
                  <Text style={styles.reportMetaLight}>{violationLabel(r.violation)}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
      <ConfirmDialog
        visible={confirmDiscard}
        title="Discard unfinished report?"
        message="The photos and details of this unsent report will be deleted from this phone. This cannot be undone."
        confirmLabel="Discard"
        destructive
        busy={discarding}
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setDiscarding(true);
          void discardDraft().finally(() => {
            setDiscarding(false);
            setConfirmDiscard(false);
          });
        }}
      />
      <UserBottomNav />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  unsentCard: { flexDirection: "row", backgroundColor: colors.amberLight, borderRadius: radius.card, padding: 14 },
  unsentTitle: { fontWeight: "800", fontSize: 14, color: colors.textPrimary },
  unsentBody: { fontSize: 12.5, color: colors.textSecondary, marginTop: 2 },
  unsentAction: { fontWeight: "800", fontSize: 13, color: colors.greenDark },
  bellBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.backgroundSunk, alignItems: "center", justifyContent: "center", marginTop: 4 },
  bellBadge: { position: "absolute", top: -3, right: -3, backgroundColor: colors.green, borderRadius: 8, minWidth: 16, height: 16, paddingHorizontal: 3, alignItems: "center", justifyContent: "center" },
  bellBadgeLabel: { fontSize: 9.5, fontWeight: "800", color: "#06210F" },
  safe: { flex: 1, backgroundColor: colors.background },
  headerBlock: { paddingHorizontal: 20, paddingTop: 4 },
  shortcut: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  shortcutLabel: { fontWeight: "700", fontSize: 13.5, color: colors.textPrimary },
  section: { paddingHorizontal: 20, marginTop: 20 },
  banner: {
    borderRadius: radius.cardLg,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
  },
  bannerIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  bannerTitle: { fontSize: 19, fontWeight: "800", color: "#06210F" },
  bannerBody: { fontSize: 12.5, color: "#0B3D22", marginTop: 4, lineHeight: 17 },
  mapCard: {
    borderRadius: radius.cardLg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    backgroundColor: colors.white,
    ...shadow.card,
  },
  mapPreview: {
    height: 170,
    backgroundColor: "#EAF0EC",
    alignItems: "center",
    justifyContent: "center",
  },
  mapDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.blue,
    borderWidth: 4,
    borderColor: "rgba(52,120,229,0.25)",
  },
  mapStrip: { flexDirection: "row", alignItems: "center", padding: 14 },
  mapStripTitle: { fontWeight: "700", fontSize: 14 },
  mapStripBody: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  reportRow: { flexDirection: "row", alignItems: "center", padding: 14 },
  reportRowDivider: { borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  reportPlate: { fontWeight: "800", fontSize: 15 },
  reportMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  reportMetaLight: { fontSize: 11.5, color: colors.textLight, marginTop: 2 },
});
