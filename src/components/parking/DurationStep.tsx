import React from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { colors } from "../../constants/colors";
import { DEFAULT_DIAL_RANGE, DialRange, dialHeadline, dialPresets } from "../../presentation/parkingDial";
import { CircularDurationPicker } from "./CircularDurationPicker";

/** Dial size for the window: large, but leaves side margins on narrow phones and room for the button on short ones. */
export const dialSizeFor = (windowWidth: number, windowHeight = 900): number =>
  Math.max(180, Math.min(270, windowWidth - 96, Math.round(windowHeight * 0.3)));

/**
 * The duration interaction shared by "start" and "extend": headline value, a
 * secondary line (end time), quick presets, and the circular dial with the
 * estimated demo cost in its centre.
 */
export function DurationDial({
  minutes,
  onChange,
  range = DEFAULT_DIAL_RANGE,
  headlinePrefix = "",
  secondary,
  centerTitle,
  centerCaption,
  accessibilityLabel,
  accessibilityValueText,
}: {
  minutes: number;
  onChange: (m: number) => void;
  range?: DialRange;
  headlinePrefix?: string;
  secondary: string;
  centerTitle: string;
  centerCaption: string;
  accessibilityLabel: string;
  accessibilityValueText: string;
}) {
  const { width, height } = useWindowDimensions();
  return (
    <View>
      <View style={styles.headline} accessibilityLiveRegion="polite">
        <Text style={styles.value}>
          {headlinePrefix}
          {dialHeadline(minutes)}
        </Text>
        <Text style={styles.secondary}>{secondary}</Text>
      </View>
      <View style={styles.presets}>
        {dialPresets(range).map((p) => {
          const on = p.minutes === minutes;
          return (
            <Pressable
              key={p.label}
              onPress={() => onChange(p.minutes)}
              style={[styles.preset, on && styles.presetOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={p.label === "Max" ? `Maximum, ${dialHeadline(p.minutes)}` : p.label}
            >
              <Text style={[styles.presetLabel, on && styles.presetLabelOn]}>{p.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <CircularDurationPicker
        value={minutes}
        onChange={onChange}
        range={range}
        size={dialSizeFor(width, height)}
        centerTitle={centerTitle}
        centerCaption={centerCaption}
        accessibilityLabel={accessibilityLabel}
        accessibilityValueText={accessibilityValueText}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  headline: { alignItems: "center", marginBottom: 12 },
  value: { fontSize: 40, fontWeight: "800", color: colors.textPrimary, letterSpacing: -0.5 },
  secondary: { fontSize: 15, fontWeight: "600", color: colors.textSecondary, marginTop: 2 },
  presets: { flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 16 },
  preset: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.backgroundSunk, minHeight: 36, justifyContent: "center" },
  presetOn: { backgroundColor: colors.greenLight },
  presetLabel: { fontSize: 13, fontWeight: "700", color: colors.textPrimary },
  presetLabelOn: { color: colors.greenDark },
});
