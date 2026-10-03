import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { typography } from "../../src/constants/typography";
import { radius, shadow, BOTTOM_NAV_HEIGHT } from "../../src/constants/spacing";
import { UserBottomNav } from "../../src/components/UserBottomNav";
import { GreenButton } from "../../src/components/GreenButton";
import { Card } from "../../src/components/Card";

export default function Parking() {
  const [active, setActive] = useState(true);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
        <Text style={typography.screenTitle}>Parking</Text>
        <Text style={typography.screenSubtitle}>Manage your parking sessions and charges</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: BOTTOM_NAV_HEIGHT + 20, gap: 16 }}>
        {/* The parking-session product is not built yet; this screen is a design preview. */}
        <View style={styles.previewBanner}>
          <Ionicons name="information-circle-outline" size={16} color={colors.blue} />
          <Text style={styles.previewText}>Preview: parking sessions and operator charges are coming soon. Sample data shown.</Text>
        </View>
        {active && (
          <Card dark>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={styles.pCircle}>
                  <Text style={{ fontWeight: "800", color: "#06210F", fontSize: 16 }}>P</Text>
                </View>
                <Text style={styles.darkTitle}>Active Parking</Text>
              </View>
              <View style={styles.timer}>
                <Text style={styles.timerText}>42:27</Text>
                <Text style={styles.timerLabel}>left</Text>
              </View>
            </View>
            <Text style={styles.plate}>HOF-782</Text>
            <Text style={styles.darkSub}>
              <Ionicons name="location" size={11} color="#B9C1BB" /> Fredrikinkatu 22, Helsinki
            </Text>
            <Text style={styles.zone}>Zone B2</Text>
            <Text style={styles.costLabel}>Current cost</Text>
            <Text style={styles.cost}>{"\u20ac2.40"}</Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
              <View style={styles.darkBtnOutline}>
                <Ionicons name="time-outline" size={15} color="#fff" />
                <Text style={styles.darkBtnOutlineLabel}>Extend</Text>
              </View>
              <Pressable style={styles.darkBtnSolid} onPress={() => setActive(false)}>
                <Ionicons name="square-outline" size={15} color={colors.red} />
                <Text style={styles.darkBtnSolidLabel}>End Parking</Text>
              </Pressable>
            </View>
          </Card>
        )}

        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable style={styles.quickAction} onPress={() => setActive(true)}>
            <Ionicons name="pricetag-outline" size={20} color={colors.greenDark} />
            <Text style={styles.quickActionLabel}>Start Parking</Text>
          </Pressable>
          <Pressable style={styles.quickAction}>
            <Ionicons name="car-outline" size={20} color={colors.greenDark} />
            <Text style={styles.quickActionLabel}>My Vehicles</Text>
          </Pressable>
          <Pressable style={styles.quickAction}>
            <Ionicons name="time-outline" size={20} color={colors.greenDark} />
            <Text style={styles.quickActionLabel}>Parking History</Text>
          </Pressable>
        </View>

        <View>
          <Text style={typography.sectionHeading}>Parking Charges</Text>
          <Card style={{ marginTop: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={styles.unpaidChip}><Text style={styles.unpaidChipLabel}>Unpaid</Text></View>
              <View style={styles.providerChip}><Text style={styles.providerChipLabel}>P</Text></View>
              <Text style={{ fontWeight: "700", fontSize: 13 }}>Parking operator</Text>
              <Text style={{ marginLeft: "auto", fontWeight: "800", fontSize: 17 }}>{"\u20ac60.00"}</Text>
            </View>
            <Text style={styles.chargeMeta}>
              <Ionicons name="car" size={12} /> JSK-306
            </Text>
            <Text style={styles.chargeMeta}>
              <Ionicons name="information-circle-outline" size={12} /> No valid parking payment found
            </Text>
            <Text style={styles.dueText}>Due Jul 30</Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <GreenButton label="Pay Now" small style={{ flex: 1 }} />
              <GreenButton label="View Details" small variant="outline" style={{ flex: 1 }} />
            </View>
          </Card>
          <Card style={{ marginTop: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={styles.paidChip}><Text style={styles.paidChipLabel}>Paid</Text></View>
              <View style={[styles.providerChip, { backgroundColor: "#12140F" }]}><Text style={styles.providerChipLabel}>A</Text></View>
              <Text style={{ fontWeight: "700", fontSize: 13 }}>Parking operator</Text>
              <Text style={{ marginLeft: "auto", fontWeight: "800", fontSize: 17 }}>{"\u20ac5.00"}</Text>
            </View>
            <Text style={styles.chargeMeta}>
              <Ionicons name="car" size={12} /> JSK-306
            </Text>
            <Text style={[styles.dueText, { color: colors.greenDark }]}>Paid Jul 27</Text>
          </Card>
        </View>

        <View>
          <Text style={typography.sectionHeading}>Registered Vehicles</Text>
          {[
            { plate: "JSK-306", model: "Volvo XC60" },
            { plate: "HOF-782", model: "Porsche Taycan" },
          ].map((v) => (
            <Pressable key={v.plate} style={styles.vehicleRow}>
              <Ionicons name="car" size={20} color={colors.textSecondary} />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={{ fontWeight: "800", fontSize: 14.5 }}>{v.plate}</Text>
                <Text style={{ fontSize: 12, color: colors.textSecondary }}>{v.model}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textLight} />
            </Pressable>
          ))}
          <Pressable style={styles.addVehicle}>
            <Ionicons name="add-circle-outline" size={18} color={colors.greenDark} />
            <Text style={styles.addVehicleLabel}>Add vehicle</Text>
          </Pressable>
        </View>
      </ScrollView>
      <UserBottomNav />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  previewBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.blueLight, borderRadius: radius.card, padding: 12 },
  previewText: { flex: 1, fontSize: 12, color: colors.textPrimary, lineHeight: 16 },
  safe: { flex: 1, backgroundColor: colors.background },
  pCircle: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.green, alignItems: "center", justifyContent: "center" },
  darkTitle: { color: "#fff", fontWeight: "800", fontSize: 17 },
  timer: { width: 76, height: 76, borderRadius: 38, borderWidth: 3, borderColor: "#fff", alignItems: "center", justifyContent: "center" },
  timerText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  timerLabel: { color: "#B9C1BB", fontSize: 9 },
  plate: { color: "#fff", fontWeight: "800", fontSize: 20, marginTop: 16 },
  darkSub: { color: "#B9C1BB", fontSize: 12.5, marginTop: 4 },
  zone: { color: colors.green, fontWeight: "700", fontSize: 12.5, marginTop: 6 },
  costLabel: { color: "#B9C1BB", fontSize: 11.5, marginTop: 14 },
  cost: { color: "#fff", fontWeight: "800", fontSize: 22, marginTop: 2 },
  darkBtnOutline: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#fff", borderRadius: radius.chip, paddingVertical: 12 },
  darkBtnOutlineLabel: { color: "#fff", fontWeight: "700", fontSize: 13 },
  darkBtnSolid: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", backgroundColor: "#fff", borderRadius: radius.chip, paddingVertical: 12 },
  darkBtnSolidLabel: { color: colors.red, fontWeight: "700", fontSize: 13 },
  quickAction: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, alignItems: "center", justifyContent: "center", paddingVertical: 18, gap: 8 },
  quickActionLabel: { fontWeight: "700", fontSize: 12, textAlign: "center" },
  unpaidChip: { backgroundColor: colors.redLight, borderRadius: radius.chip, paddingHorizontal: 10, paddingVertical: 3 },
  unpaidChipLabel: { color: colors.red, fontWeight: "700", fontSize: 11 },
  paidChip: { backgroundColor: colors.greenLight, borderRadius: radius.chip, paddingHorizontal: 10, paddingVertical: 3 },
  paidChipLabel: { color: colors.greenDark, fontWeight: "700", fontSize: 11 },
  providerChip: { width: 20, height: 20, borderRadius: 6, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center" },
  providerChipLabel: { color: "#fff", fontWeight: "800", fontSize: 11 },
  chargeMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 6 },
  dueText: { fontSize: 11.5, fontWeight: "700", color: colors.red, marginTop: 4 },
  vehicleRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 14, marginTop: 10 },
  addVehicle: { flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: colors.green, borderStyle: "dashed", borderRadius: radius.card, paddingVertical: 14, marginTop: 10 },
  addVehicleLabel: { color: colors.greenDark, fontWeight: "700" },
});
