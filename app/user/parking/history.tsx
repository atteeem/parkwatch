import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../../src/constants/colors";
import { radius, shadow } from "../../../src/constants/spacing";
import { BackHeader } from "../../../src/components/Header";
import { useApp } from "../../../src/context/AppContext";

// Parking History: completed simulated sessions, newest first.
export default function ParkingHistory() {
  const router = useRouter();
  const { parkingHistory } = useApp();

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <BackHeader title="Parking History" onBack={() => (router.canGoBack() ? router.back() : router.replace("/user/parking"))} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
        {parkingHistory.length === 0 && (
          <View style={styles.empty}>
            <Ionicons name="time-outline" size={30} color={colors.textLight} />
            <Text style={styles.emptyTitle}>No parking history yet</Text>
            <Text style={styles.emptyText}>Ended parking sessions appear here.</Text>
          </View>
        )}
        {parkingHistory.map((h) => (
          <View key={h.id} style={styles.card}>
            <View style={styles.topRow}>
              <Text style={styles.plate}>{h.plate}</Text>
              <View style={styles.statusChip}>
                <Text style={styles.statusLabel}>{h.statusText}</Text>
              </View>
              <Text style={styles.cost}>{h.costText}</Text>
            </View>
            <Text style={styles.meta}>
              <Ionicons name="location-outline" size={12} /> {h.location} {"·"} {h.zone}
            </Text>
            <Text style={styles.meta}>
              <Ionicons name="calendar-outline" size={12} /> {h.dateText} {"·"} {h.startText}
              {"–"}
              {h.endText} {"·"} {h.durationText}
            </Text>
          </View>
        ))}
        {parkingHistory.length > 0 && <Text style={styles.note}>Costs are simulated at the demo rate; nothing was charged.</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  card: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 14, ...shadow.card },
  topRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  plate: { fontWeight: "800", fontSize: 16 },
  statusChip: { backgroundColor: colors.greenLight, borderRadius: radius.chip, paddingHorizontal: 10, paddingVertical: 3 },
  statusLabel: { fontSize: 11, fontWeight: "700", color: colors.greenDark },
  cost: { marginLeft: "auto", fontWeight: "800", fontSize: 16 },
  meta: { fontSize: 12.5, color: colors.textSecondary, marginTop: 6 },
  note: { fontSize: 12, color: colors.textLight, textAlign: "center", marginTop: 4 },
  empty: { alignItems: "center", padding: 32 },
  emptyTitle: { fontWeight: "800", fontSize: 16, marginTop: 8 },
  emptyText: { fontSize: 13, color: colors.textSecondary, marginTop: 4 },
});
