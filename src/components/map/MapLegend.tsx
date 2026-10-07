import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../constants/colors";

/** Explains the two map symbols: the report pin and the user's GPS dot. */
export function MapLegend({ showUser = true }: { showUser?: boolean }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={showUser ? "Red pin: report location. Blue dot: your location." : "Red pin: report location."}>
      <View style={styles.item}>
        <Ionicons name="location" size={14} color="#D93025" />
        <Text style={styles.label}>Report location</Text>
      </View>
      {showUser ? (
        <View style={styles.item}>
          <View style={styles.dot} />
          <Text style={styles.label}>You</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 14, marginTop: 6 },
  item: { flexDirection: "row", alignItems: "center", gap: 4 },
  label: { fontSize: 11.5, color: colors.textSecondary, fontWeight: "600" },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#3478E5", borderWidth: 2, borderColor: "#fff", shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 1 },
});
