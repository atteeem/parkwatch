import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors } from "../constants/colors";
import { typography } from "../constants/typography";

type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
};

// Big left-aligned header: Home, Parking, My Reports, Map, Notifications,
// Profile, Settings, Report Queue, My Cases...
export function ScreenHeader({ title, subtitle, right }: ScreenHeaderProps) {
  return (
    <View style={styles.screenHeaderRow}>
      <View style={{ flex: 1 }}>
        <Text style={typography.screenTitle}>{title}</Text>
        {subtitle ? <Text style={typography.screenSubtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

type BackHeaderProps = {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
};

// Centered title + back arrow: Report flow steps, Report Details, En
// Route, On-Site Inspection, Inspection Result, Report overview...
export function BackHeader({ title, subtitle, onBack, right }: BackHeaderProps) {
  const router = useRouter();
  return (
    <View>
      <View style={styles.backHeaderRow}>
        <Pressable
          onPress={onBack ?? (() => router.back())}
          hitSlop={10}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.backHeaderTitle} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.backHeaderRight}>{right}</View>
      </View>
      {subtitle ? <Text style={styles.backHeaderSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screenHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  backHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  backHeaderTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 20,
    fontWeight: "800",
    color: colors.textPrimary,
    marginRight: 36,
  },
  backHeaderRight: {
    position: "absolute",
    right: 12,
  },
  backHeaderSubtitle: {
    textAlign: "center",
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: "500",
    paddingBottom: 10,
  },
});
