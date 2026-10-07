import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleProp, Text, TextStyle } from "react-native";
import { MOTION, motionDuration } from "../../constants/motion";
import { useReducedMotion } from "../../hooks/useReducedMotion";

/** Values between `from` and `to` for a short transition (pure; used by AnimatedNumber and tests). */
export function interpolateValue(from: number, to: number, t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return from + (to - from) * clamped;
}

/**
 * A number that eases to a new value (~280 ms) when it changes, e.g. a balance
 * after a refresh. First render shows the value directly (no counting up), and
 * Reduce Motion shows changes instantly. Only animates real data changes.
 */
export function AnimatedNumber({
  value,
  format,
  style,
  accessibilityLabel,
}: {
  value: number;
  format: (v: number) => string;
  style?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const anim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    const ms = motionDuration(MOTION.SCREEN, reduceMotion);
    if (ms === 0) {
      from.current = value;
      setShown(value);
      return;
    }
    anim.setValue(0);
    const id = anim.addListener(({ value: t }) => setShown(interpolateValue(start, value, t)));
    Animated.timing(anim, { toValue: 1, duration: ms, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(() => {
      from.current = value;
      setShown(value);
    });
    return () => {
      anim.removeListener(id);
      anim.stopAnimation();
      from.current = value;
    };
  }, [value, reduceMotion, anim]);

  // Screen readers always get the real value, never an intermediate one.
  return (
    <Text style={style} accessibilityLabel={accessibilityLabel ?? format(value)}>
      {format(shown)}
    </Text>
  );
}
