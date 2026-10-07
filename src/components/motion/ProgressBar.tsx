import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { colors } from "../../constants/colors";
import { MOTION, motionDuration } from "../../constants/motion";
import { useReducedMotion } from "../../hooks/useReducedMotion";

/** 0..1 progress for "done of total" (pure; guards against 0 and overflow). */
export const progressFraction = (done: number, total: number): number => (total <= 0 ? 0 : Math.max(0, Math.min(1, done / total)));

/** Thin progress bar that eases to its new value (~200 ms; instant with Reduce Motion). Display only. */
export function ProgressBar({ done, total, accessibilityLabel }: { done: number; total: number; accessibilityLabel?: string }) {
  const reduceMotion = useReducedMotion();
  const value = progressFraction(done, total);
  const w = useRef(new Animated.Value(value)).current;
  useEffect(() => {
    const ms = motionDuration(MOTION.NORMAL, reduceMotion);
    if (ms === 0) {
      w.setValue(value);
      return;
    }
    const a = Animated.timing(w, { toValue: value, duration: ms, useNativeDriver: false });
    a.start();
    return () => a.stop();
  }, [value, reduceMotion, w]);
  return (
    <View
      style={styles.track}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: total, now: done }}
    >
      <Animated.View style={[styles.fill, { width: w.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 5, borderRadius: 3, backgroundColor: colors.backgroundSunk, overflow: "hidden", marginBottom: 10 },
  fill: { height: 5, borderRadius: 3, backgroundColor: colors.greenDark },
});
