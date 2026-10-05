import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { typography } from "../../src/constants/typography";
import { BOTTOM_NAV_HEIGHT } from "../../src/constants/spacing";
import { UserBottomNav } from "../../src/components/UserBottomNav";
import { Card } from "../../src/components/Card";
import { SettingsRow } from "../../src/components/SettingsRow";

function SectionLabel({ text }: { text: string }) {
  return <Text style={styles.sectionLabel}>{text}</Text>;
}

// Settings. The MVP has no accounts, push/email service or theming yet, so
// those rows are shown as unavailable (dimmed, not pressable, no switches)
// instead of controls that would pretend to change something.
export default function Settings() {
  const router = useRouter();
  const version = Constants.expoConfig?.version ?? "1.0.0";

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        {router.canGoBack() && (
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} onPress={() => router.back()} accessibilityLabel="Back" style={{ marginBottom: 4 }} />
        )}
        <Text style={typography.screenTitle}>Settings</Text>
        <Text style={typography.screenSubtitle}>Manage your preferences and account settings</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: BOTTOM_NAV_HEIGHT + 20, gap: 6 }}>
        <SectionLabel text="ACCOUNT" />
        <Card noPadding>
          <SettingsRow icon="person" title="Personal Information" unavailable />
          <View style={styles.divider} />
          <SettingsRow icon="lock-closed" title="Password" unavailable />
          <View style={styles.divider} />
          <SettingsRow icon="shield-checkmark" title="Identity Verification" subtitle="Not available yet" unavailable />
        </Card>

        <SectionLabel text="NOTIFICATIONS" />
        <Card noPadding>
          <SettingsRow icon="notifications" title="Push Notifications" subtitle="Not available in demo · in-app notifications only" unavailable />
          <View style={styles.divider} />
          <SettingsRow icon="mail" title="Email Notifications" unavailable />
        </Card>

        <SectionLabel text="APPEARANCE" />
        <Card noPadding>
          <SettingsRow icon="moon" title="Dark Mode" subtitle="Not available in demo · light theme only" unavailable />
        </Card>

        <SectionLabel text="LANGUAGE" />
        <Card noPadding>
          <SettingsRow icon="globe" title="Language" subtitle="English · other languages not available in demo" unavailable />
        </Card>

        <SectionLabel text="PRIVACY" />
        <Card noPadding>
          <SettingsRow icon="shield" title="Privacy & Data" unavailable />
          <View style={styles.divider} />
          <SettingsRow icon="trash" title="Delete Account" subtitle="Not available until real accounts exist" unavailable />
        </Card>

        <SectionLabel text="ABOUT" />
        <Card noPadding>
          <SettingsRow icon="information-circle" iconBg={colors.blueLight} iconColor={colors.blue} title="About App" subtitle={`ParkWatch ${version} · demo build`} />
          <View style={styles.divider} />
          <SettingsRow icon="help-circle" title="Help Center" unavailable />
        </Card>
      </ScrollView>
      <UserBottomNav />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: 20, paddingTop: 4 },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: colors.textSecondary, marginTop: 14, marginBottom: 8, marginLeft: 2 },
  divider: { height: 1, backgroundColor: colors.borderLight, marginLeft: 60 },
});
