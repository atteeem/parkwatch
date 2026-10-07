import React from "react";
import { View, StyleSheet } from "react-native";
import { useRouter, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../constants/colors";
import { tabNavigation } from "../navigation/roleGuard";
import { OFFICER_NAV_ITEMS } from "./officerNavItems";
import { NavTab } from "./NavTab";

export function OfficerBottomNav() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) + 6 }]}>
      {OFFICER_NAV_ITEMS.map((item) => {
        const active = pathname === item.path;
        return (
          <NavTab
            key={item.key}
            icon={item.icon}
            label={item.label}
            active={active}
            onPress={() => {
              // Tabs replace each other; tapping the current tab does nothing.
              if (tabNavigation(pathname, item.path) === "replace") router.replace(item.path as any);
            }}
          />
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
