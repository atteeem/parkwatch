import React, { useEffect } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { typography } from "../../src/constants/typography";
import { radius, BOTTOM_NAV_HEIGHT } from "../../src/constants/spacing";
import { OfficerBottomNav } from "../../src/components/OfficerBottomNav";
import { usePagedList, useApp } from "../../src/context/AppContext";
import { ListFooter, listSettledEmpty, useCoreRefreshControl } from "../../src/components/CoreDataGate";
import { NotifKind } from "../../src/data/mockNotifications";
import { officerNotificationTarget } from "../../src/navigation/notificationTargets";

const KIND_STYLE: Record<NotifKind, { bg: string; fg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  success: { bg: colors.greenLight, fg: colors.greenDark, icon: "checkmark-circle" },
  pending: { bg: colors.amberLight, fg: "#B47A00", icon: "time" },
  info: { bg: colors.blueLight, fg: colors.blue, icon: "person" },
  error: { bg: colors.redLight, fg: colors.red, icon: "alert-circle" },
  gift: { bg: colors.greenLight, fg: colors.greenDark, icon: "gift" },
  bell: { bg: colors.purpleLight, fg: colors.purple, icon: "notifications" },
  flag: { bg: colors.greenLight, fg: colors.greenDark, icon: "flag" },
  duplicate: { bg: colors.redLight, fg: colors.red, icon: "copy" },
  calendar: { bg: colors.blueLight, fg: colors.blue, icon: "calendar" },
};

export default function OfficerNotifications() {
  const router = useRouter();
  const { markOfficerNotificationsRead, getCase } = useApp();
  const refreshControl = useCoreRefreshControl();
  const list = usePagedList({ kind: "notifications", role: "OFFICER" });
  const officerNotifications = list.items;
  useEffect(() => {
    const t = setTimeout(markOfficerNotificationsRead, 800);
    return () => clearTimeout(t);
  }, []);

  const groups = Array.from(new Set(officerNotifications.map((n) => n.group)));

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
        {router.canGoBack() && (
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back" style={{ marginBottom: 4, alignSelf: "flex-start" }}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
        )}
        <Text style={typography.screenTitle}>Notifications</Text>
        <Text style={typography.screenSubtitle}>Updates about your cases</Text>
      </View>
      <ScrollView refreshControl={refreshControl} contentContainerStyle={{ padding: 20, paddingBottom: BOTTOM_NAV_HEIGHT + 20 }}>
        {listSettledEmpty(list) && <Text style={styles.empty}>No notifications yet.</Text>}
        {groups.map((group) => (
          <View key={group} style={{ marginBottom: 18 }}>
            <Text style={styles.groupLabel}>{group}</Text>
            {officerNotifications
              .filter((n) => n.group === group)
              .map((n) => {
                const k = KIND_STYLE[n.kind];
                // Tap opens the case only if it still exists; otherwise the card is plain information.
                const target = officerNotificationTarget(n, (id) => !!getCase(id));
                const Wrapper = target ? Pressable : View;
                return (
                  <Wrapper
                    key={n.id}
                    style={styles.card}
                    {...(target ? { onPress: () => router.push(target), accessibilityRole: "button" as const } : {})}
                  >
                    <View style={[styles.iconWrap, { backgroundColor: k.bg }]}>
                      <Ionicons name={k.icon} size={18} color={k.fg} />
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                        <Text style={styles.title}>{n.title}</Text>
                        <Text style={styles.time}>{n.time}</Text>
                      </View>
                      <Text style={styles.body}>{n.body}</Text>
                    </View>
                    {n.unread && <View style={styles.dot} />}
                    {target && <Ionicons name="chevron-forward" size={16} color={colors.textLight} style={{ marginLeft: 6, alignSelf: "center" }} />}
                  </Wrapper>
                );
              })}
          </View>
        ))}
        <ListFooter list={list} />
      </ScrollView>
      <OfficerBottomNav />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  empty: { color: colors.textSecondary, fontSize: 13, textAlign: "center", marginTop: 20 },
  groupLabel: { fontSize: 16, fontWeight: "800", marginBottom: 10 },
  card: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: 14,
    marginBottom: 10,
    alignItems: "flex-start",
  },
  iconWrap: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  title: { fontWeight: "800", fontSize: 14 },
  time: { fontSize: 11, color: colors.textLight },
  body: { fontSize: 12.5, color: colors.textSecondary, marginTop: 3, lineHeight: 17 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.green, marginLeft: 8, marginTop: 4 },
});
