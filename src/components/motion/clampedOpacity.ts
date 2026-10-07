import { Animated } from "react-native";

/**
 * Opacity driven by an animation progress that may overshoot (springs,
 * Easing.back). Scale/translate may overshoot on purpose; opacity must stay
 * within 0..1.
 */
export const clampedOpacity = (progress: Animated.Value): Animated.AnimatedInterpolation<number> =>
  progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" });
