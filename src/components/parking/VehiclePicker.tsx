import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../constants/colors";
import { VehicleView } from "../../presentation/parkingViews";
import { SheetCTA, SheetHeader } from "./sheetParts";

/** Choose the vehicle to park; plate first, model underneath. */
export function VehiclePicker({
  vehicles,
  selectedId,
  onSelect,
  onAdd,
  onContinue,
  onBack,
}: {
  vehicles: VehicleView[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  return (
    <View>
      <SheetHeader title="Vehicle" subtitle={vehicles.length ? "Which vehicle are you parking?" : "Add the vehicle you want to park"} onBack={onBack} />
      <View accessibilityRole="radiogroup">
        {vehicles.map((v, i) => {
          const selected = v.id === selectedId;
          return (
            <Pressable
              key={v.id}
              onPress={() => onSelect(v.id)}
              style={({ pressed }) => [styles.row, i > 0 && styles.divider, pressed && { opacity: 0.6 }]}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={[v.plate, v.title].filter(Boolean).join(", ")}
            >
              <View style={[styles.icon, selected && styles.iconSelected]}>
                <Ionicons name="car" size={18} color={selected ? colors.white : colors.textSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.plate}>{v.plate}</Text>
                {!!(v.title || v.color) && <Text style={styles.sub}>{[v.title, v.color].filter(Boolean).join(" · ")}</Text>}
              </View>
              <Ionicons name={selected ? "checkmark-circle" : "ellipse-outline"} size={24} color={selected ? colors.greenDark : colors.border} />
            </Pressable>
          );
        })}
      </View>
      <Pressable onPress={onAdd} style={[styles.row, vehicles.length > 0 && styles.divider]} accessibilityRole="button" accessibilityLabel="Add vehicle">
        <View style={styles.addIcon}>
          <Ionicons name="add" size={20} color={colors.greenDark} />
        </View>
        <Text style={styles.add}>Add vehicle</Text>
      </Pressable>
      <SheetCTA label="Continue" onPress={onContinue} disabled={!selectedId} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, minHeight: 60 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight },
  icon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.backgroundSunk, alignItems: "center", justifyContent: "center" },
  iconSelected: { backgroundColor: colors.greenDark },
  plate: { fontSize: 17, fontWeight: "800", letterSpacing: 0.5, color: colors.textPrimary },
  sub: { fontSize: 12.5, color: colors.textSecondary, marginTop: 2 },
  addIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.greenLight, alignItems: "center", justifyContent: "center" },
  add: { fontSize: 15, fontWeight: "700", color: colors.greenDark },
});
