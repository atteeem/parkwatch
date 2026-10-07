import React from "react";
import { StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";
import { colors } from "../constants/colors";
import { unreadBadgeText } from "../presentation/unreadBadge";

/** Small unread-count pill (capped at 99+). Renders nothing for 0. Decorative: the parent's label says the count. */
export function UnreadBadge({ count, style }: { count: number; style?: StyleProp<ViewStyle> }) {
  const text = unreadBadgeText(count);
  if (!text) return null;
  return (
    <View style={[styles.badge, style]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Text style={styles.label} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { backgroundColor: colors.green, borderRadius: 8, minWidth: 16, height: 16, paddingHorizontal: 4, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 9.5, fontWeight: "800", color: "#06210F" },
});
