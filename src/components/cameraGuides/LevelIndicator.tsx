import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../../constants/colors";
import { LEVEL_MESSAGE, LevelState } from "../../presentation/deviceLevel";

const LINE_W = 54;

/**
 * Small horizon line under the guide: green and short label when the phone is
 * level, amber with a hint when tilted or tipped back/forward. Guidance only -
 * it never blocks the shutter. Nothing is shown while the sensor is unknown.
 */
export function LevelIndicator({ level }: { level: LevelState }) {
  const message = LEVEL_MESSAGE[level.status];
  if (!message) return <View style={styles.placeholder} />;
  const ok = level.status === "level";
  const color = ok ? colors.green : colors.amber;
  // The line shows where "level" is relative to the screen (clamped so it stays compact).
  const angle = Math.max(-25, Math.min(25, -level.roll));
  return (
    <View style={styles.row} accessibilityLiveRegion="polite" accessibilityLabel={ok ? "Phone is level" : message}>
      <View style={[styles.tick, { backgroundColor: color }]} />
      <View style={[styles.line, { backgroundColor: color, transform: [{ rotate: `${level.status === "notUpright" ? 0 : angle}deg` }] }]} />
      <View style={[styles.tick, { backgroundColor: color }]} />
      <Text style={[styles.text, { color }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { height: 22 },
  row: { height: 22, flexDirection: "row", alignItems: "center", gap: 6 },
  tick: { width: 2, height: 8, borderRadius: 1, opacity: 0.8 },
  line: { width: LINE_W, height: 2.5, borderRadius: 2 },
  text: {
    fontSize: 12,
    fontWeight: "800",
    marginLeft: 4,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowRadius: 3,
    textShadowOffset: { width: 0, height: 1 },
  },
});
