import React from "react";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { typography } from "../../src/constants/typography";
import { radius, shadow, BOTTOM_NAV_HEIGHT } from "../../src/constants/spacing";
import { UserBottomNav } from "../../src/components/UserBottomNav";
import { Card } from "../../src/components/Card";
import { DemoTools } from "../../src/components/DemoTools";
import { useApp } from "../../src/context/AppContext";
import { DEMO_CITIZEN_ACCOUNT } from "../../src/store/demoAccounts";
import { citizenReportStats } from "../../src/presentation/citizenViews";
import { Avatar } from "../../src/components/Avatar";

function Row({
  icon,
  iconBg,
  iconColor,
  title,
  subtitle,
  right,
  onPress,
  destructive,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconBg: string;
  iconColor: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  destructive?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={17} color={iconColor} />
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={[styles.rowTitle, destructive && { color: colors.red }]}>{title}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {right ?? <Ionicons name="chevron-forward" size={16} color={colors.textLight} />}
    </Pressable>
  );
}

export default function UserProfile() {
  const router = useRouter();
  const { walletAvailable, userReports, getEarnings } = useApp();
  const stats = citizenReportStats(userReports);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
        <Text style={typography.screenTitle}>Profile</Text>
        <Text style={typography.screenSubtitle}>Manage your account and view your activity</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: BOTTOM_NAV_HEIGHT + 20 }}>
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Avatar name={DEMO_CITIZEN_ACCOUNT.fullName} size={64} />
            <View style={{ marginLeft: 14, flex: 1 }}>
              <Text style={styles.name}>{DEMO_CITIZEN_ACCOUNT.fullName}</Text>
              <Text style={styles.locationRow}>
                <Ionicons name="location" size={12} /> {DEMO_CITIZEN_ACCOUNT.city}
              </Text>
              <View style={styles.verifiedBadge}>
                <Ionicons name="checkmark-circle" size={13} color={colors.greenDark} />
                <Text style={styles.verifiedLabel}>Active reporter</Text>
              </View>
              <Text style={styles.memberSince}>
                <Ionicons name="calendar-outline" size={11} /> Member since {DEMO_CITIZEN_ACCOUNT.memberSince}
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

        <Text style={styles.sectionHeading}>Account</Text>
        <Card noPadding>
          <Row icon="wallet" iconBg={colors.greenLight} iconColor={colors.greenDark} title="Wallet" subtitle="View your balance and earnings" right={<Text style={styles.rowValue}>{"\u20ac"}{walletAvailable.toFixed(2)}</Text>} onPress={() => router.push("/user/earnings")} />
          <View style={styles.divider} />
          <Row icon="business" iconBg={colors.blueLight} iconColor={colors.blue} title="Payment Method" subtitle={"Bank account \u2022\u2022\u2022\u2022 1234"} />
          <View style={styles.divider} />
          <Row icon="shield-checkmark" iconBg={colors.purpleLight} iconColor={colors.purple} title="Identity Verification" subtitle="Not available yet" />
          <View style={styles.divider} />
          <Row icon="gift" iconBg={colors.amberLight} iconColor="#B47A00" title="Referral Program" subtitle="Invite friends and earn more" />
        </Card>

        <Text style={styles.sectionHeading}>App</Text>
        <Card noPadding>
          <Row icon="settings" iconBg={colors.backgroundSunk} iconColor={colors.textSecondary} title="Settings" subtitle="App preferences and notifications" onPress={() => router.push("/user/settings")} />
          <View style={styles.divider} />
          <Row icon="help-circle" iconBg={colors.backgroundSunk} iconColor={colors.textSecondary} title="Help Center" subtitle="FAQs and support" />
          <View style={styles.divider} />
          <Row icon="document" iconBg={colors.backgroundSunk} iconColor={colors.textSecondary} title="Terms of Service" subtitle="Read our terms and conditions" />
          <View style={styles.divider} />
          <Row icon="lock-closed" iconBg={colors.backgroundSunk} iconColor={colors.textSecondary} title="Privacy Policy" subtitle="How we handle your data" />
        </Card>

        <Card style={{ alignItems: "center", marginTop: 16 }}>
          <Pressable style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="log-out-outline" size={18} color={colors.red} />
            <Text style={{ color: colors.red, fontWeight: "800", fontSize: 15 }}>Log Out</Text>
          </Pressable>
        </Card>
        <DemoTools />
      </ScrollView>
      <UserBottomNav />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  avatar: { width: 64, height: 64, borderRadius: 32 },
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
