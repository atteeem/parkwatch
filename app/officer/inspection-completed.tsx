import React from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { radius } from "../../src/constants/spacing";
import { GreenButton } from "../../src/components/GreenButton";
import { Card } from "../../src/components/Card";
import { useApp } from "../../src/context/AppContext";

export default function InspectionCompleted() {
  const router = useRouter();
  const { id, outcome } = useLocalSearchParams<{ id: string; outcome: string }>();
  const { officerCases, resetOfficerDraft } = useApp();
  const c = officerCases.find((x) => x.id === id);
  const charged = outcome === "charge";

  if (!c) return null;

  const handleNextCase = () => {
    resetOfficerDraft();
    const next = officerCases.find((x) => x.status === "new");
    if (next) {
      router.replace({ pathname: "/officer/report-details", params: { id: next.id } });
    } else {
      router.replace("/officer/queue");
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={{ flex: 1, padding: 24, alignItems: "center" }}>
        <View style={styles.successCircle}>
          <Ionicons name="checkmark" size={40} color={colors.greenDark} />
        </View>
        <Text style={styles.title}>Inspection Completed</Text>
        <Text style={styles.subtitle}>Thank you! Your inspection has been recorded.</Text>

        <Card style={{ width: "100%", marginTop: 22 }}>
          <View style={{ flexDirection: "row" }}>
            <Image source={{ uri: c.images[0] }} style={styles.img} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.location}>
                <Ionicons name="location" size={12} color={colors.greenDark} /> {c.location}
              </Text>
              <Text style={styles.meta}>{new Date().toLocaleDateString()} at {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
              <Text style={styles.fieldLabel}>Vehicle</Text>
              <Text style={styles.fieldValue}>{c.plate}</Text>
              <Text style={styles.fieldLabel}>Violation</Text>
              <Text style={styles.fieldValue}>{c.violation}</Text>
              <Text style={styles.fieldLabel}>Report ID</Text>
              <Text style={styles.fieldValue}>#{c.reportId}</Text>
              {charged && (
                <>
                  <Text style={styles.fieldLabel}>Parking charge</Text>
                  <Text style={[styles.fieldValue, { color: colors.greenDark }]}>{"\u20ac60"}</Text>
                </>
              )}
            </View>
          </View>
        </Card>

        <Text style={styles.summaryHeading}>Case Summary</Text>
        <View style={{ width: "100%", gap: 8 }}>
          {[
            { label: "On-site inspection", value: null },
            { label: "Officer photos", value: "4 / 4" },
            { label: charged ? "Parking charge issued" : "Case closed", value: charged ? "\u20ac60" : null },
            { label: "Case status", value: "Closed" },
          ].map((row) => (
            <View key={row.label} style={styles.summaryRow}>
              <Text style={styles.summaryRowLabel}>{row.label}</Text>
              {row.value && <Text style={styles.summaryRowValue}>{row.value}</Text>}
              <Ionicons name="checkmark-circle" size={18} color="#06210F" />
            </View>
          ))}
        </View>

        <View style={{ width: "100%", marginTop: "auto", gap: 10 }}>
          <GreenButton label="Next Case" icon="navigate" onPress={handleNextCase} />
          <GreenButton label="Return to Home" variant="outline" icon="home" onPress={() => router.replace("/officer/home")} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  successCircle: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.greenLight, alignItems: "center", justifyContent: "center", marginTop: 20 },
  title: { fontSize: 22, fontWeight: "800", marginTop: 16 },
  subtitle: { fontSize: 13.5, color: colors.textSecondary, textAlign: "center", marginTop: 6 },
  img: { width: 84, height: 84, borderRadius: radius.photo },
  location: { fontWeight: "800", fontSize: 14 },
  meta: { fontSize: 11.5, color: colors.textSecondary, marginTop: 3 },
  fieldLabel: { fontSize: 10.5, color: colors.textLight, marginTop: 6 },
  fieldValue: { fontSize: 13, fontWeight: "700" },
  summaryHeading: { fontSize: 16, fontWeight: "800", alignSelf: "flex-start", marginTop: 18, marginBottom: 10 },
  summaryRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.green, borderRadius: radius.button, paddingHorizontal: 14, paddingVertical: 13 },
  summaryRowLabel: { flex: 1, fontWeight: "800", fontSize: 13.5, color: "#06210F" },
  summaryRowValue: { fontWeight: "700", fontSize: 13, color: "#06210F", marginRight: 10 },
});
