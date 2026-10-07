import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../../src/constants/colors";
import { radius, shadow } from "../../../src/constants/spacing";
import { BackHeader } from "../../../src/components/Header";
import { GreenButton } from "../../../src/components/GreenButton";
import { EmptyFromCopy } from "../../../src/components/EmptyState";
import { VEHICLES_EMPTY } from "../../../src/presentation/emptyStates";
import { useApp } from "../../../src/context/AppContext";

// My Vehicles: the citizen's locally registered vehicles. No ownership
// verification or registry lookup yet.
export default function MyVehicles() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { vehicles } = useApp();

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <BackHeader title="My Vehicles" subtitle="Vehicles you can park" onBack={() => (router.canGoBack() ? router.back() : router.replace("/user/parking"))} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 + insets.bottom, gap: 12 }}>
        {vehicles.length === 0 && (
          <EmptyFromCopy copy={VEHICLES_EMPTY} />
        )}
        {vehicles.map((v) => (
          <View key={v.id} style={styles.card}>
            <View style={styles.icon}>
              <Ionicons name="car" size={20} color={colors.greenDark} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.plate}>{v.plate}</Text>
              <Text style={styles.sub}>{[v.title || "Vehicle", v.color].filter(Boolean).join(" · ")}</Text>
            </View>
            {v.isDefault && (
              <View style={styles.defaultChip}>
                <Text style={styles.defaultLabel}>Default</Text>
              </View>
            )}
          </View>
        ))}
        {vehicles.length > 0 && <Text style={styles.note}>The default vehicle is preselected when you start parking (the one you used last).</Text>}
      </ScrollView>
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
        <GreenButton label="Add Vehicle" icon="add-circle" trailingIcon={null} onPress={() => router.push("/user/parking/add-vehicle")} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  card: { flexDirection: "row", alignItems: "center", backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 14, ...shadow.card },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.greenLight, alignItems: "center", justifyContent: "center" },
  plate: { fontWeight: "800", fontSize: 16 },
  sub: { fontSize: 12.5, color: colors.textSecondary, marginTop: 2 },
  defaultChip: { backgroundColor: colors.greenLight, borderRadius: radius.chip, paddingHorizontal: 10, paddingVertical: 4 },
  defaultLabel: { fontSize: 11, fontWeight: "800", color: colors.greenDark },
  note: { fontSize: 12, color: colors.textLight, textAlign: "center", marginTop: 4 },
  empty: { alignItems: "center", padding: 32 },
  emptyTitle: { fontWeight: "800", fontSize: 16, marginTop: 8 },
  emptyText: { fontSize: 13, color: colors.textSecondary, marginTop: 4 },
  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 12, backgroundColor: colors.background },
});
