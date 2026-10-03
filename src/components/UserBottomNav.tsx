import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, usePathname } from "expo-router";
import { colors } from "../constants/colors";

import { useReportDraft } from "../context/ReportContext";
import { isUserNavItemActive, USER_NAV_ITEMS } from "./userNavItems";

export function UserBottomNav() {
  const router = useRouter();
  const pathname = usePathname();
  const { startNewReport } = useReportDraft();

  return (
    <View style={styles.bar}>
      {USER_NAV_ITEMS.map((item) => {
        const active = isUserNavItemActive(item, pathname);
        return (
          <Pressable key={item.key} style={styles.item} onPress={() => {
              // The Report tab is an intentional "new report" entry point.
              if (item.key === "report") startNewReport();
              router.push(item.path as any);
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
    paddingBottom: 26,
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
