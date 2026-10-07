import React, { useEffect, useRef } from "react";
import { AccessibilityActionEvent, FlatList, NativeScrollEvent, NativeSyntheticEvent, StyleSheet, Text, View } from "react-native";
import { colors } from "../constants/colors";
import { radius } from "../constants/spacing";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { formatClock, wheelIndexFor } from "../presentation/parkingViews";

export const WHEEL_ROW_HEIGHT = 44;
const VISIBLE_ROWS = 5;
const PAD = WHEEL_ROW_HEIGHT * Math.floor(VISIBLE_ROWS / 2);

/**
 * Vertical end-time picker: rows every 5 minutes, snapping so the centred row
 * is the selection. Updates live while scrolling. For screen readers it is one
 * "adjustable" control (swipe up/down = 5 minutes later/earlier) whose value
 * reads "Ends at 14:35, 1 h 25 min".
 */
export function EndTimeWheel({
  options,
  value,
  onChange,
  accessibilityValueText,
}: {
  /** Selectable end times (epoch ms), ascending. */
  options: number[];
  /** Selected end time (epoch ms; one of options). */
  value: number;
  onChange: (endMs: number) => void;
  accessibilityValueText: string;
}) {
  const reduceMotion = useReducedMotion();
  const listRef = useRef<FlatList<number>>(null);
  const index = wheelIndexFor(options, value);
  /** Row last reported by the user's own scrolling (or last moved to by us). */
  const lastReported = useRef(index);
  /** true while WE scroll the list: those scroll events are not user choices. */
  const programmatic = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const moveTo = (i: number, animated: boolean) => {
    lastReported.current = i;
    programmatic.current = true;
    listRef.current?.scrollToOffset({ offset: i * WHEEL_ROW_HEIGHT, animated });
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => (programmatic.current = false), animated ? 450 : 60);
  };
  useEffect(() => () => clearTimeout(settleTimer.current), []);

  // External changes (presets, clamping as time passes): move the wheel there.
  // A change that came from the user's own scrolling is already in place.
  useEffect(() => {
    if (index === lastReported.current) return;
    moveTo(index, !reduceMotion);
  }, [index, reduceMotion]); // eslint-disable-line react-hooks/exhaustive-deps

  const report = (y: number) => {
    if (programmatic.current) return;
    const i = Math.max(0, Math.min(options.length - 1, Math.round(y / WHEEL_ROW_HEIGHT)));
    if (i !== lastReported.current) {
      lastReported.current = i;
      onChange(options[i]);
    }
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => report(e.nativeEvent.contentOffset.y);
  const onSettle = (e: NativeSyntheticEvent<NativeScrollEvent>) => report(e.nativeEvent.contentOffset.y);

  const step = (by: number) => {
    const i = Math.max(0, Math.min(options.length - 1, index + by));
    if (i !== index) onChange(options[i]);
  };

  return (
    <View
      style={styles.wrap}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Parking end time"
      accessibilityValue={{ text: accessibilityValueText }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e: AccessibilityActionEvent) => step(e.nativeEvent.actionName === "increment" ? 1 : -1)}
    >
      <View style={styles.band} pointerEvents="none" />
      <FlatList
        ref={listRef}
        data={options}
        keyExtractor={(t) => String(t)}
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ROW_HEIGHT}
        decelerationRate="fast"
        nestedScrollEnabled
        contentOffset={{ x: 0, y: index * WHEEL_ROW_HEIGHT }}
        // Start on the selected row (contentOffset is not honoured on every platform).
        onLayout={() => moveTo(index, false)}
        getItemLayout={(_d, i) => ({ length: WHEEL_ROW_HEIGHT, offset: PAD + WHEEL_ROW_HEIGHT * i, index: i })}
        contentContainerStyle={{ paddingVertical: PAD }}
        onScrollBeginDrag={() => {
          // The user takes over: their scrolling is a choice again.
          programmatic.current = false;
        }}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={onSettle}
        onScrollEndDrag={(e) => {
          // No momentum (slow release): settle here.
          if (!e.nativeEvent.velocity || Math.abs(e.nativeEvent.velocity.y) < 0.05) onSettle(e);
        }}
        importantForAccessibility="no-hide-descendants"
        renderItem={({ item, index: i }) => {
          const selected = i === index;
          const near = Math.abs(i - index) === 1;
          return (
            <View style={styles.row}>
              <Text style={[styles.rowText, selected && styles.rowTextSelected, !selected && !near && styles.rowTextFar]}>
                {formatClock(new Date(item).toISOString())}
              </Text>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: WHEEL_ROW_HEIGHT * VISIBLE_ROWS, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, overflow: "hidden" },
  band: {
    position: "absolute",
    left: 10,
    right: 10,
    top: PAD,
    height: WHEEL_ROW_HEIGHT,
    borderRadius: 10,
    backgroundColor: colors.greenLight,
  },
  row: { height: WHEEL_ROW_HEIGHT, alignItems: "center", justifyContent: "center" },
  rowText: { fontSize: 18, fontWeight: "600", color: colors.textSecondary, fontVariant: ["tabular-nums"] },
  rowTextSelected: { fontSize: 22, fontWeight: "800", color: colors.greenDark },
  rowTextFar: { opacity: 0.45 },
});
