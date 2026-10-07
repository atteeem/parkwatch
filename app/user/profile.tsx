import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { typography } from "../../src/constants/typography";
import { radius, shadow, BOTTOM_NAV_HEIGHT } from "../../src/constants/spacing";
import { UserBottomNav } from "../../src/components/UserBottomNav";
import { Card } from "../../src/components/Card";
import { SettingsRow } from "../../src/components/SettingsRow";
import { DemoTools } from "../../src/components/DemoTools";
import { useApp } from "../../src/context/AppContext";
import { useAuth } from "../../src/auth/AuthContext";
import { displayIdentity } from "../../src/auth/identity";
import { SignOutRow } from "../../src/components/SignOutRow";
import { citizenStatsFromCounts } from "../../src/presentation/citizenViews";
import { Avatar } from "../../src/components/Avatar";
import { AvatarEditSheet } from "../../src/components/AvatarEditSheet";
import { useMyAvatar } from "../../src/auth/AvatarContext";

export default function UserProfile() {
  const router = useRouter();
  const { walletAvailable, citizenSummary, getEarnings } = useApp();
  // Server counts in backend mode (every report, not a loaded page).
  const stats = citizenStatsFromCounts(citizenSummary);
  const me = displayIdentity(useAuth().state, "citizen");
  const avatar = useMyAvatar();
  const [sheet, setSheet] = useState(false);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
        <Text style={typography.screenTitle}>Profile</Text>
        <Text style={typography.screenSubtitle}>Manage your account and view your activity</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: BOTTOM_NAV_HEIGHT + 20 }}>
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Pressable
              onPress={() => avatar.canEdit && !avatar.busy && setSheet(true)}
              disabled={!avatar.canEdit || avatar.busy}
              accessibilityRole="button"
              accessibilityLabel={avatar.uri ? "Change profile photo" : "Add profile photo"}
              hitSlop={6}
            >
              <Avatar name={me.fullName} size={64} uri={avatar.uri} />
              {avatar.canEdit ? (
                <View style={styles.avatarBadge}>
                  {avatar.busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="camera" size={12} color="#fff" />}
                </View>
              ) : null}
            </Pressable>
            <View style={{ marginLeft: 14, flex: 1 }}>
              <Text style={styles.name}>{me.fullName}</Text>
              <Text style={styles.locationRow}>
                {me.demo?.city ? <><Ionicons name="location" size={12} /> {me.demo.city}</> : me.email}
              </Text>
              <View style={styles.verifiedBadge}>
                <Ionicons name="checkmark-circle" size={13} color={colors.greenDark} />
                <Text style={styles.verifiedLabel}>Active reporter</Text>
              </View>
              <Text style={styles.memberSince}>
                <Ionicons name="calendar-outline" size={11} /> {me.demo?.memberSince ? `Member since ${me.demo.memberSince}` : "ParkWatch account"}
              </Text>
            </View>
          </View>
          <View style={styles.statsRow}>
            {[
              { icon: "document-text", value: String(stats.submitted), label: "Reports Submitted" },
              { icon: "checkmark", value: String(stats.verified), label: "Verified Reports" },
              { icon: "stats-chart", value: stats.acceptanceRateText, label: "Acceptance Rate" },
              { icon: "wallet", value: getEarnings("ALL_TIME").totalText, label: "Total Earned" },
            ].map((s) => (
              <View key={s.label} style={styles.statItem}>
                <View style={styles.statCircle}>
                  <Ionicons name={s.icon as any} size={17} color={colors.greenDark} />
                </View>
                <Text style={styles.statValue}>{s.value}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        </Card>

        {avatar.error ? (
          <Pressable onPress={avatar.clearError} accessibilityRole="button">
            <Text style={styles.avatarError}>{avatar.error}</Text>
          </Pressable>
        ) : null}

        <Text style={styles.sectionHeading}>Account</Text>
        <Card noPadding>
          <SettingsRow icon="wallet" iconBg={colors.greenLight} iconColor={colors.greenDark} title="Wallet" subtitle="View your balance and earnings" right={<Text style={styles.rowValue}>{"\u20ac"}{walletAvailable.toFixed(2)}</Text>} onPress={() => router.push("/user/earnings")} />
          <View style={styles.divider} />
          {/* Local demo: the example payout account (not editable). Signed in: payment methods don't exist yet. */}
          {me.source === "DEMO" ? (
            <SettingsRow icon="business" iconBg={colors.blueLight} iconColor={colors.blue} title="Payment Method" subtitle={"Bank account \u2022\u2022\u2022\u2022 1234 \u00b7 demo payout account, not editable"} />
          ) : (
            <SettingsRow icon="business" title="Payment Method" unavailable />
          )}
          <View style={styles.divider} />
          <SettingsRow icon="shield-checkmark" title="Identity Verification" unavailable />
          <View style={styles.divider} />
          <SettingsRow icon="gift" title="Referral Program" unavailable />
        </Card>

        <Text style={styles.sectionHeading}>App</Text>
        <Card noPadding>
          <SettingsRow icon="settings" iconBg={colors.backgroundSunk} iconColor={colors.textSecondary} title="Settings" subtitle="App preferences and notifications" onPress={() => router.push("/user/settings")} />
          <View style={styles.divider} />
          <SettingsRow icon="help-circle" title="Help Center" subtitle="How reporting and rewards work" onPress={() => router.push("/user/info/help")} />
          <View style={styles.divider} />
          <SettingsRow icon="information-circle" iconBg={colors.blueLight} iconColor={colors.blue} title="About ParkWatch" subtitle="What this version does" onPress={() => router.push("/user/info/about")} />
          <View style={styles.divider} />
          <SettingsRow icon="document" title="Terms of Service" subtitle="Draft · final terms not yet published" onPress={() => router.push("/user/info/terms")} />
          <View style={styles.divider} />
          <SettingsRow icon="lock-closed" title="Privacy Policy" subtitle="Draft · final policy not yet published" onPress={() => router.push("/user/info/privacy-policy")} />
        </Card>

        {/* Real Sign Out in backend mode; in the local demo it says it isn't available. */}
        <Card noPadding style={{ marginTop: 16 }}>
          <SignOutRow />
        </Card>
        <DemoTools />
      </ScrollView>
      <UserBottomNav />
      <AvatarEditSheet
        visible={sheet}
        hasPhoto={!!avatar.uri}
        onClose={() => setSheet(false)}
        onChoose={(source) => {
          setSheet(false);
          void avatar.choose(source);
        }}
        onRemove={() => {
          setSheet(false);
          void avatar.remove();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  avatar: { width: 64, height: 64, borderRadius: 32 },
  avatarBadge: { position: "absolute", right: -2, bottom: -2, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.greenDark, borderWidth: 2, borderColor: colors.white, alignItems: "center", justifyContent: "center" },
  avatarError: { color: "#B3261E", fontSize: 12.5, fontWeight: "600", marginTop: 10, textAlign: "center" },
  name: { fontSize: 18, fontWeight: "800" },
  locationRow: { fontSize: 12.5, color: colors.textSecondary, marginTop: 3 },
  verifiedBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.greenLight, alignSelf: "flex-start", borderRadius: radius.chip, paddingHorizontal: 8, paddingVertical: 3, marginTop: 6 },
  verifiedLabel: { fontSize: 11, fontWeight: "700", color: colors.greenDark },
  memberSince: { fontSize: 11, color: colors.textLight, marginTop: 6 },
  statsRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.borderLight },
  statItem: { alignItems: "center", flex: 1 },
  statCircle: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.greenLight, alignItems: "center", justifyContent: "center" },
  statValue: { fontWeight: "800", fontSize: 15, marginTop: 6 },
  statLabel: { fontSize: 10, color: colors.textSecondary, textAlign: "center", marginTop: 2 },
  sectionHeading: { fontSize: 17, fontWeight: "800", marginTop: 20, marginBottom: 10 },
  row: { flexDirection: "row", alignItems: "center", padding: 14 },
  rowIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontWeight: "700", fontSize: 14.5 },
  rowSubtitle: { fontSize: 11.5, color: colors.textSecondary, marginTop: 2 },
  rowValue: { fontWeight: "700", fontSize: 13, color: colors.textSecondary },
  divider: { height: 1, backgroundColor: colors.borderLight, marginLeft: 60 },
});
