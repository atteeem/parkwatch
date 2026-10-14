import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path } from "react-native-svg";
import { colors } from "../../constants/colors";
import { sideDrawing, VEHICLE_GUIDE_PROFILES, VEHICLE_TYPE_LABEL, VehicleGuideProfile } from "../../presentation/vehicleGuideGeometry";

export const VEHICLE_TYPE_PICKER_TITLE = "Choose the closest vehicle type";
export const VEHICLE_TYPE_PICKER_NOTE = "This only changes the outline that helps you frame the photos. It is not part of the report.";

/** Small side silhouette for a type card (same geometry as the camera guide). */
function TypeIcon({ profile, selected }: { profile: VehicleGuideProfile; selected: boolean }) {
  const d = sideDrawing(profile);
  const color = selected ? colors.greenDark : colors.textPrimary;
  return (
    <Svg width={96} height={40} viewBox={d.viewBox} preserveAspectRatio="xMidYMid meet">
      <Path d={d.outline} stroke={color} strokeWidth={1.6} fill="none" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      {d.wheels.map((w, i) => (
        <Circle key={i} cx={w.cx} cy={w.cy} r={w.r} stroke={color} strokeWidth={1.6} fill="none" vectorEffect="non-scaling-stroke" />
      ))}
    </Svg>
  );
}

/**
 * Bottom sheet: pick the closest body type (or "Not sure" = a generic car).
 * Shown at the start of the 3-photo step and from the "Vehicle type" chip.
 */
export function VehicleTypePicker({
  visible,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  selected?: VehicleGuideProfile;
  onSelect: (p: VehicleGuideProfile) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const options: VehicleGuideProfile[] = [...VEHICLE_GUIDE_PROFILES, "GENERIC"];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close vehicle type">
        <Pressable style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 12 }]} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.title} accessibilityRole="header">
            {VEHICLE_TYPE_PICKER_TITLE}
          </Text>
          <Text style={styles.note}>{VEHICLE_TYPE_PICKER_NOTE}</Text>
          <ScrollView contentContainerStyle={styles.grid} accessibilityRole="radiogroup">
            {options.map((p) => {
              const on = p === selected;
              return (
                <Pressable
                  key={p}
                  onPress={() => onSelect(p)}
                  style={({ pressed }) => [styles.card, on && styles.cardOn, pressed && { opacity: 0.7 }]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={VEHICLE_TYPE_LABEL[p]}
                  testID={`vehicle-type-${p}`}
                >
                  <TypeIcon profile={p} selected={on} />
                  <Text style={[styles.cardLabel, on && styles.cardLabelOn]}>{VEHICLE_TYPE_LABEL[p]}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Compact chip on the camera: "Vehicle: SUV · Change". */
export function VehicleTypeChip({ profile, onPress }: { profile?: VehicleGuideProfile; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.chip} accessibilityRole="button" accessibilityLabel={`Vehicle type: ${VEHICLE_TYPE_LABEL[profile ?? "GENERIC"]}. Change`} hitSlop={6}>
      <Text style={styles.chipText}>
        Vehicle: <Text style={styles.chipStrong}>{VEHICLE_TYPE_LABEL[profile ?? "GENERIC"]}</Text> · Change
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 8, maxHeight: "86%" },
  handle: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: 10 },
  title: { fontSize: 18, fontWeight: "800", color: colors.textPrimary },
  note: { fontSize: 12.5, color: colors.textSecondary, marginTop: 4, marginBottom: 12, lineHeight: 17 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingBottom: 4 },
  card: { flexBasis: "47%", flexGrow: 1, borderRadius: 14, borderWidth: 1.5, borderColor: colors.borderLight, paddingVertical: 10, alignItems: "center", gap: 4, minHeight: 84 },
  cardOn: { borderColor: colors.greenDark, backgroundColor: colors.greenLight },
  cardLabel: { fontSize: 13.5, fontWeight: "700", color: colors.textPrimary },
  cardLabelOn: { color: colors.greenDark },
  chip: { backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { color: "#D8DDD9", fontSize: 12.5, fontWeight: "600" },
  chipStrong: { color: "#fff", fontWeight: "800" },
});
