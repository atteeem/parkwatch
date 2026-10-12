import React, { useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, Text, View } from "react-native";
import { colors } from "../../constants/colors";
import {
  accessibilityStep,
  angleAt,
  angleForMinutes,
  arcFraction,
  DEFAULT_DIAL_RANGE,
  DIAL_DEAD_ZONE_PX,
  DialDrag,
  DialRange,
  moveDrag,
  startDrag,
} from "../../presentation/parkingDial";

const RING = 20;
const HANDLE = 38;

/**
 * Large circular duration control: drag the handle (or anywhere on the ring)
 * around the circle; one turn = one hour, turning on adds hours. Values snap
 * to 5 minutes and stay within `range`. Screen readers get an adjustable
 * control (increment/decrement by 15 minutes) instead of the drag.
 */
export function CircularDurationPicker({
  value,
  onChange,
  range = DEFAULT_DIAL_RANGE,
  size = 260,
  accessibilityLabel = "Parking duration",
  accessibilityValueText,
  centerTitle,
  centerCaption,
}: {
  value: number;
  onChange: (minutes: number) => void;
  range?: DialRange;
  size?: number;
  accessibilityLabel?: string;
  accessibilityValueText: string;
  centerTitle?: string;
  centerCaption?: string;
}) {
  const S = size;
  const R = S / 2 - RING / 2;
  // While dragging, the handle follows the finger (unsnapped) so movement is smooth.
  const [dragRaw, setDragRaw] = useState<number | null>(null);
  const drag = useRef<DialDrag | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const latest = useRef({ value, onChange, range });
  latest.current = { value, onChange, range };

  const angleOf = (pageX: number, pageY: number): number | null => {
    const o = origin.current;
    if (!o) return null;
    const dx = pageX - (o.x + S / 2);
    const dy = pageY - (o.y + S / 2);
    if (Math.hypot(dx, dy) < DIAL_DEAD_ZONE_PX) return null;
    return angleAt(dx, dy, 0, 0);
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          // The dial's page origin, synchronously from the touch itself: every child
          // ignores touches, so location* is relative to the dial.
          const { pageX, pageY, locationX, locationY } = e.nativeEvent;
          origin.current = { x: pageX - locationX, y: pageY - locationY };
          const a = angleOf(pageX, pageY);
          drag.current = a === null ? null : startDrag(a, latest.current.value);
        },
        onPanResponderMove: (e) => {
          const a = angleOf(e.nativeEvent.pageX, e.nativeEvent.pageY);
          if (a === null) return;
          if (!drag.current) {
            drag.current = startDrag(a, latest.current.value);
            return;
          }
          const next = moveDrag(drag.current, a, latest.current.range);
          drag.current = next;
          setDragRaw(next.raw);
          if (next.value !== latest.current.value) latest.current.onChange(next.value);
        },
        onPanResponderRelease: () => {
          drag.current = null;
          setDragRaw(null);
        },
        onPanResponderTerminate: () => {
          drag.current = null;
          setDragRaw(null);
        },
      }),
    [S] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const shown = dragRaw ?? value;
  const fraction = arcFraction(shown);
  const angle = fraction >= 1 ? 360 : angleForMinutes(shown);
  const handleAngle = (angle * Math.PI) / 180;
  const ring = { width: S, height: S, borderRadius: S / 2, borderWidth: RING, borderColor: colors.green };
  const rightRot = Math.min(angle, 180);
  const leftRot = Math.max(0, angle - 180);

  return (
    <View
      style={{ width: S, height: S, alignSelf: "center" }}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ text: accessibilityValueText }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => {
        const dir = e.nativeEvent.actionName === "increment" ? 1 : e.nativeEvent.actionName === "decrement" ? -1 : 0;
        if (dir) onChange(accessibilityStep(value, dir, range));
      }}
      {...pan.panHandlers}
    >
      {/* track */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: S / 2, borderWidth: RING, borderColor: colors.backgroundSunk }]} />
      {/* tick marks every 5 minutes; longer each quarter hour */}
      {Array.from({ length: 12 }, (_, i) => (
        <View key={i} pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${i * 30}deg` }] }]}>
          <View style={[styles.tick, { left: S / 2 - 1, top: RING + 6, height: i % 3 === 0 ? 10 : 5 }]} />
        </View>
      ))}
      {/* progress arc (two clipped half rings; no SVG needed) */}
      {angle > 0 && (
        <View pointerEvents="none" style={{ position: "absolute", left: S / 2, top: 0, width: S / 2, height: S, overflow: "hidden" }}>
          <View style={{ position: "absolute", left: -S / 2, top: 0, width: S, height: S, transform: [{ rotate: `${rightRot}deg` }] }}>
            <View style={{ position: "absolute", left: 0, top: 0, width: S / 2, height: S, overflow: "hidden" }}>
              <View style={ring} />
            </View>
          </View>
        </View>
      )}
      {angle > 180 && (
        <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width: S / 2, height: S, overflow: "hidden" }}>
          <View style={{ position: "absolute", left: 0, top: 0, width: S, height: S, transform: [{ rotate: `${leftRot}deg` }] }}>
            <View style={{ position: "absolute", left: S / 2, top: 0, width: S / 2, height: S, overflow: "hidden" }}>
              <View style={[ring, { position: "absolute", left: -S / 2 }]} />
            </View>
          </View>
        </View>
      )}
      {/* rounded start of the arc */}
      {shown > 0 && <View pointerEvents="none" style={[styles.cap, { left: S / 2 - RING / 2, top: 0 }]} />}
      {/* centre */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
        {!!centerTitle && <Text style={styles.centerTitle}>{centerTitle}</Text>}
        {!!centerCaption && <Text style={styles.centerCaption}>{centerCaption}</Text>}
      </View>
      {/* handle */}
      <View
        pointerEvents="none"
        style={[
          styles.handle,
          dragRaw !== null && styles.handleActive,
          { left: S / 2 + R * Math.sin(handleAngle) - HANDLE / 2, top: S / 2 - R * Math.cos(handleAngle) - HANDLE / 2 },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tick: { position: "absolute", width: 2, borderRadius: 1, backgroundColor: colors.border },
  cap: { position: "absolute", width: RING, height: RING, borderRadius: RING / 2, backgroundColor: colors.green },
  center: { alignItems: "center", justifyContent: "center", padding: RING + 24 },
  centerTitle: { fontSize: 26, fontWeight: "800", color: colors.textPrimary },
  centerCaption: { fontSize: 12, color: colors.textSecondary, marginTop: 2, textAlign: "center" },
  handle: {
    position: "absolute",
    width: HANDLE,
    height: HANDLE,
    borderRadius: HANDLE / 2,
    backgroundColor: colors.white,
    borderWidth: 3,
    borderColor: colors.greenDark,
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  handleActive: { transform: [{ scale: 1.12 }] },
});
