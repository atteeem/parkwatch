import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleProp, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../constants/colors";
import { MOTION, motionDuration } from "../../constants/motion";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { clampedOpacity } from "./clampedOpacity";

/**
 * Success circle used after a citizen submits a report and after an officer
 * completes a case: the circle scales in, then the check fades/scales in
 * (≈500 ms total). With Reduce Motion it is shown immediately.
 */
export function SuccessMark({
  size = 88,
  icon = "checkmark",
  background = colors.greenLight,
  color = colors.greenDark,
  style,
}: {
  size?: number;
  icon?: keyof typeof Ionicons.glyphMap;
  background?: string;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReducedMotion();
  const circle = useRef(new Animated.Value(0)).current;
  const check = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const total = motionDuration(MOTION.SUCCESS, reduceMotion);
    if (total === 0) {
      circle.setValue(1);
      check.setValue(1);
      return;
    }
    const seq = Animated.sequence([
      Animated.timing(circle, { toValue: 1, duration: total * 0.55, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }),
      Animated.timing(check, { toValue: 1, duration: total * 0.45, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]);
    seq.start();
    return () => seq.stop();
  }, [circle, check, reduceMotion]);

  return (
    <Animated.View
      accessibilityRole="image"
      accessibilityLabel="Success"
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: background, alignItems: "center", justifyContent: "center" },
        style,
        // Easing.back overshoots: keep the scale overshoot, clamp the opacity.
        { opacity: clampedOpacity(circle), transform: [{ scale: circle.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] },
      ]}
    >
      <Animated.View style={{ opacity: check, transform: [{ scale: check.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }] }}>
        <Ionicons name={icon} size={size * 0.45} color={color} />
      </Animated.View>
    </Animated.View>
  );
}
