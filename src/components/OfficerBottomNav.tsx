import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../constants/colors";
import { tabNavigation } from "../navigation/roleGuard";
import { OFFICER_NAV_ITEMS } from "./officerNavItems";

export function OfficerBottomNav() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) + 6 }]}>
      {OFFICER_NAV_ITEMS.map((item) => {
        const active = pathname === item.path;
        return (
          <Pressable
            key={item.key}
            style={styles.item}
            onPress={() => {
              // Tabs replace each other; tapping the current tab does nothing.
              if (tabNavigation(pathname, item.path) === "replace") router.replace(item.path as any);
            }}
          >
            <Ionicons name={item.icon as any} size={22} color={active ? colors.greenDark : colors.black} />
            <Text style={[styles.label, active && styles.labelActive]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
  },
  item: {
    flex: 1,
    alignItems: "center",
    gap: 3,
  },
  label: {
    fontSize: 10.5,
    fontWeight: "600",
    color: colors.black,
  },
  labelActive: {
    color: colors.greenDark,
  },
});
