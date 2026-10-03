import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, usePathname } from "expo-router";
import { colors } from "../constants/colors";

const ITEMS: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; path: string }[] = [
  { key: "home", label: "Home", icon: "home", path: "/user/home" },
  { key: "parking", label: "Parking", icon: "pricetag", path: "/user/parking" },
  { key: "report", label: "Report", icon: "camera", path: "/user/report/photos" },
  { key: "reports", label: "Reports", icon: "document-text", path: "/user/reports" },
  { key: "profile", label: "Profile", icon: "person", path: "/user/profile" },
];

export function UserBottomNav() {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <View style={styles.bar}>
      {ITEMS.map((item) => {
        const active =
          item.key === "report" ? pathname.startsWith("/user/report") : pathname === item.path;
        return (
          <Pressable key={item.key} style={styles.item} onPress={() => router.push(item.path as any)}>
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
