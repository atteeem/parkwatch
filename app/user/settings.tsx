import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, Switch, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { typography } from "../../src/constants/typography";
import { radius, BOTTOM_NAV_HEIGHT } from "../../src/constants/spacing";
import { UserBottomNav } from "../../src/components/UserBottomNav";
import { Card } from "../../src/components/Card";

function SettingRow({
  icon,
  iconBg,
  iconColor,
  title,
  subtitle,
  toggle,
  destructive,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconBg: string;
  iconColor: string;
  title: string;
  subtitle: string;
  toggle?: { value: boolean; onChange: (v: boolean) => void };
  destructive?: boolean;
}) {
  return (
    <Pressable style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={17} color={iconColor} />
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={[styles.rowTitle, destructive && { color: colors.red }]}>{title}</Text>
        <Text style={styles.rowSubtitle}>{subtitle}</Text>
      </View>
      {toggle && (
        <Switch
          value={toggle.value}
          onValueChange={toggle.onChange}
          trackColor={{ true: colors.green, false: colors.border }}
          thumbColor="#fff"
        />
      )}
    </Pressable>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <Text style={styles.sectionLabel}>{text}</Text>;
}

export default function Settings() {
  const [push, setPush] = useState(true);
  const [email, setEmail] = useState(true);
  const [dark, setDark] = useState(false);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
        <Text style={typography.screenTitle}>Settings</Text>
        <Text style={typography.screenSubtitle}>Manage your preferences and account settings</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: BOTTOM_NAV_HEIGHT + 20, gap: 6 }}>
        <SectionLabel text="ACCOUNT" />
        <Card noPadding>
          <SettingRow icon="person" iconBg={colors.blueLight} iconColor={colors.blue} title="Personal Information" subtitle="Update your name, email and phone number" />
          <View style={styles.divider} />
          <SettingRow icon="lock-closed" iconBg={colors.purpleLight} iconColor={colors.purple} title="Password" subtitle="Change your password" />
          <View style={styles.divider} />
          <SettingRow icon="shield-checkmark" iconBg={colors.greenLight} iconColor={colors.greenDark} title="Identity Verification" subtitle="Manage your verification status" />
        </Card>

        <SectionLabel text="NOTIFICATIONS" />
        <Card noPadding>
          <SettingRow icon="notifications" iconBg={colors.blueLight} iconColor={colors.blue} title="Push Notifications" subtitle="Receive notifications on your device" toggle={{ value: push, onChange: setPush }} />
          <View style={styles.divider} />
          <SettingRow icon="mail" iconBg={colors.purpleLight} iconColor={colors.purple} title="Email Notifications" subtitle="Receive important updates via email" toggle={{ value: email, onChange: setEmail }} />
        </Card>

        <SectionLabel text="APPEARANCE" />
        <Card noPadding>
          <SettingRow icon="moon" iconBg={colors.backgroundSunk} iconColor={colors.textSecondary} title="Dark Mode" subtitle="Use dark theme in the app" toggle={{ value: dark, onChange: setDark }} />
        </Card>

        <SectionLabel text="LANGUAGE" />
        <Card noPadding>
          <SettingRow icon="globe" iconBg={colors.blueLight} iconColor={colors.blue} title="Language" subtitle="Choose your preferred language" />
        </Card>

        <SectionLabel text="PRIVACY" />
        <Card noPadding>
          <SettingRow icon="shield" iconBg={colors.greenLight} iconColor={colors.greenDark} title="Privacy & Data" subtitle="Manage how we handle your data" />
          <View style={styles.divider} />
          <SettingRow icon="trash" iconBg={colors.redLight} iconColor={colors.red} title="Delete Account" subtitle="Permanently delete your account and data" destructive />
        </Card>

        <SectionLabel text="ABOUT" />
        <Card noPadding>
          <SettingRow icon="information-circle" iconBg={colors.blueLight} iconColor={colors.blue} title="About App" subtitle="Version 1.0.0" />
          <View style={styles.divider} />
          <SettingRow icon="help-circle" iconBg={colors.amberLight} iconColor="#B47A00" title="Help Center" subtitle="Get help and contact support" />
        </Card>
      </ScrollView>
      <UserBottomNav />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: colors.textSecondary, marginTop: 14, marginBottom: 8, marginLeft: 2 },
  row: { flexDirection: "row", alignItems: "center", padding: 14 },
  rowIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontWeight: "700", fontSize: 14.5 },
  rowSubtitle: { fontSize: 11.5, color: colors.textSecondary, marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.borderLight, marginLeft: 60 },
});
