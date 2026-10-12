import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { colors } from "../../constants/colors";
import { MOTION, motionDuration } from "../../constants/motion";
import { useReducedMotion } from "../../hooks/useReducedMotion";

/** Visible height of a collapsed sheet (handle + first line). */
export const SHEET_PEEK_HEIGHT = 74;
/** Upper limit for the sheet as a share of the window (the map stays visible). */
export const SHEET_MAX_SHARE = 0.68;

/** Drag distance/velocity that toggles collapsed/expanded on release (pure; tested). */
export function sheetSnap(expanded: boolean, dy: number, vy: number): boolean {
  if (vy > 0.6 || dy > 60) return false;
  if (vy < -0.6 || dy < -60) return true;
  return expanded;
}

/**
 * Bottom sheet over the map. Content-sized up to SHEET_MAX_SHARE of the window
 * (then it scrolls). The handle can be dragged or tapped to collapse it to a
 * peek so the map can be used, and back. `onHeight` reports the covered height
 * so the map keeps centred things above the sheet.
 */
export function ParkingSheet({
  children,
  bottomOffset,
  stepKey,
  onHeight,
  accessibilityLabel,
  footer,
}: {
  children: React.ReactNode;
  /** Pinned under the scrolling content (the step's main button stays reachable on short phones). */
  footer?: React.ReactNode;
  /** Space below the sheet (the bottom navigation). */
  bottomOffset: number;
  /** Changes when the flow step changes: the sheet re-opens and the content fades in. */
  stepKey: string;
  onHeight?: (coveredHeight: number) => void;
  accessibilityLabel?: string;
}) {
  const { height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(true);
  const [contentHeight, setContentHeight] = useState(0);
  const translate = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const maxHeight = Math.round(windowHeight * SHEET_MAX_SHARE);
  const collapseBy = Math.max(0, Math.min(contentHeight, maxHeight) - SHEET_PEEK_HEIGHT);

  const animateTo = (open: boolean) => {
    setExpanded(open);
    Animated.timing(translate, { toValue: open ? 0 : collapseBy, duration: motionDuration(MOTION.NORMAL, reduceMotion), useNativeDriver: true }).start();
  };

  // A new step always opens the sheet and fades its content in.
  useEffect(() => {
    animateTo(true);
    if (reduceMotion) return;
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: MOTION.NORMAL, useNativeDriver: true }).start();
  }, [stepKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onHeight?.(expanded ? Math.min(contentHeight, maxHeight) : SHEET_PEEK_HEIGHT);
  }, [expanded, contentHeight, maxHeight]); // eslint-disable-line react-hooks/exhaustive-deps

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_e, g) => {
          const base = expanded ? 0 : collapseBy;
          translate.setValue(Math.min(collapseBy, Math.max(0, base + g.dy)));
        },
        onPanResponderRelease: (_e, g) => animateTo(sheetSnap(expanded, g.dy, g.vy)),
        onPanResponderTerminate: () => animateTo(expanded),
      }),
    [expanded, collapseBy] // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <Animated.View
      style={[styles.sheet, { bottom: bottomOffset, maxHeight, transform: [{ translateY: translate }] }]}
      onLayout={(e) => setContentHeight(Math.round(e.nativeEvent.layout.height))}
      accessibilityLabel={accessibilityLabel}
    >
      <View {...pan.panHandlers}>
        <Pressable
          onPress={() => animateTo(!expanded)}
          style={styles.handleHit}
          accessibilityRole="button"
          accessibilityLabel={expanded ? "Collapse parking panel to show the map" : "Expand parking panel"}
          hitSlop={8}
        >
          <View style={styles.handle} />
        </Pressable>
      </View>
      <ScrollView
        style={{ flexShrink: 1 }}
        bounces={false}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, !!footer && { paddingBottom: 4 }]}
      >
        <Animated.View style={{ opacity: fade }}>{children}</Animated.View>
      </ScrollView>
      {!!footer && <View style={styles.footer}>{footer}</View>}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    backgroundColor: colors.white,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  handleHit: { alignItems: "center", paddingTop: 10, paddingBottom: 6 },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border },
  content: { paddingHorizontal: 20, paddingBottom: 18 },
  footer: { paddingHorizontal: 20, paddingBottom: 14 },
});
