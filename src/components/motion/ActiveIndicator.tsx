import React, { useEffect, useRef } from "react";
import { Animated, StyleProp, ViewStyle } from "react-native";
import { MOTION, motionDuration } from "../../constants/motion";
import { useReducedMotion } from "../../hooks/useReducedMotion";

/** 0 -> 1 when `active` becomes true (and back), over ~200 ms; instant with Reduce Motion. */
export function useActiveProgress(active: boolean): Animated.Value {
  const reduceMotion = useReducedMotion();
  const v = useRef(new Animated.Value(active ? 1 : 0)).current;
  useEffect(() => {
    const ms = motionDuration(MOTION.NORMAL, reduceMotion);
    if (ms === 0) {
      v.setValue(active ? 1 : 0);
      return;
    }
    const a = Animated.timing(v, { toValue: active ? 1 : 0, duration: ms, useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [active, reduceMotion, v]);
  return v;
}

/**
 * The visual "selected" layer of a tab, filter pill or segment: fades and
 * scales in when the item becomes active. Purely decorative (the item's
 * accessibilityState carries the selection). Place it absolutely inside the item.
 */
export function ActiveIndicator({ active, style, fromScale = 0.92 }: { active: boolean; style?: StyleProp<ViewStyle>; fromScale?: number }) {
  const p = useActiveProgress(active);
  return (
    <Animated.View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      style={[style, { opacity: p, transform: [{ scale: p.interpolate({ inputRange: [0, 1], outputRange: [fromScale, 1] }) }] }]}
    />
  );
}
