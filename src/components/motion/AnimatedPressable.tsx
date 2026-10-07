import React, { useRef, useState } from "react";
import { Animated, GestureResponderEvent, Pressable, PressableProps, StyleProp, ViewStyle } from "react-native";
import { MOTION, pressScale } from "../../constants/motion";
import { useReducedMotion } from "../../hooks/useReducedMotion";

const AnimatedBase = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, "style"> & {
  /** Same as Pressable: a style or a function of the pressed state. */
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean }) => StyleProp<ViewStyle>);
};

/**
 * Pressable with a subtle scale press effect (1.00 -> 0.98 -> 1.00, ~130 ms).
 * Accessibility, onPress semantics and the disabled state are exactly those of
 * Pressable: disabled presses never animate, and nothing animates when the OS
 * "Reduce Motion" setting is on.
 */
export function AnimatedPressable({ style, onPressIn, onPressOut, disabled, children, ...rest }: Props) {
  const reduceMotion = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const [pressed, setPressed] = useState(false);
  const to = (value: number) =>
    Animated.timing(scale, { toValue: value, duration: MOTION.FAST, useNativeDriver: true }).start();

  const resolved = typeof style === "function" ? style({ pressed }) : style;
  return (
    <AnimatedBase
      {...rest}
      disabled={disabled}
      onPressIn={(e: GestureResponderEvent) => {
        setPressed(true);
        const target = pressScale({ disabled: !!disabled, reduceMotion });
        if (target !== 1) to(target);
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        setPressed(false);
        to(1);
        onPressOut?.(e);
      }}
      style={[resolved, { transform: [{ scale }] }]}
    >
      {children}
    </AnimatedBase>
  );
}
