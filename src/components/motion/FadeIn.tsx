import React, { useEffect, useRef } from "react";
import { Animated, StyleProp, ViewStyle } from "react-native";
import { MOTION, motionDuration } from "../../constants/motion";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { clampedOpacity } from "./clampedOpacity";

/**
 * Content that enters once: opacity 0 -> 1 and a small upward move.
 * Never blocks touches (children are interactive immediately). With Reduce
 * Motion on it simply appears.
 */
export function FadeIn({
  children,
  style,
  offsetY = MOTION.SMALL_Y_OFFSET,
  duration = MOTION.SCREEN,
  delay = 0,
  spring = false,
  fromScale = 1,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  offsetY?: number;
  duration?: number;
  delay?: number;
  /** Soft spring instead of easing (bottom sheets). */
  spring?: boolean;
  /** Optional slight scale-in (e.g. 0.92 for a photo slot that just got its photo). */
  fromScale?: number;
}) {
  const reduceMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const ms = motionDuration(duration, reduceMotion);
    if (ms === 0) {
      progress.setValue(1);
      return;
    }
    const anim = spring
      ? Animated.spring(progress, { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 180, mass: 0.8, delay })
      : Animated.timing(progress, { toValue: 1, duration: ms, delay, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [progress, duration, delay, spring, reduceMotion]);

  return (
    <Animated.View
      style={[
        style,
        {
          // The spring may overshoot 1: movement may, opacity may not.
          opacity: clampedOpacity(progress),
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [offsetY, 0] }) },
            { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [fromScale, 1] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
