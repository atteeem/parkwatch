import React from "react";
import { Animated, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../constants/colors";
import { useActiveProgress } from "./motion/ActiveIndicator";

/**
 * One bottom-nav tab (citizen and officer). The active tab's icon grows a
 * little, its label lifts slightly and a small pill appears (~200 ms; none with
 * Reduce Motion). Press handling is the caller's: navigation is unchanged.
 */
export function NavTab({ icon, label, active, onPress }: { icon: string; label: string; active: boolean; onPress: () => void }) {
  const p = useActiveProgress(active);
  return (
    <Pressable
      style={styles.item}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
    >
      <Animated.View style={{ transform: [{ scale: p.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] }) }] }}>
        <Ionicons name={icon as never} size={22} color={active ? colors.greenDark : colors.black} />
      </Animated.View>
      <Animated.Text
        style={[
          styles.label,
          active && styles.labelActive,
          { transform: [{ translateY: p.interpolate({ inputRange: [0, 1], outputRange: [0, -1] }) }] },
        ]}
      >
        {label}
      </Animated.Text>
      <Animated.View style={[styles.pill, { opacity: p, transform: [{ scaleX: p.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: { flex: 1, alignItems: "center", gap: 3 },
  label: { fontSize: 10.5, fontWeight: "600", color: colors.black },
  labelActive: { color: colors.greenDark },
  pill: { width: 16, height: 3, borderRadius: 2, backgroundColor: colors.greenDark },
});
