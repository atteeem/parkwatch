import React from "react";
import { View, Text, ScrollView, Image, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { radius } from "../../src/constants/spacing";
import { BackHeader } from "../../src/components/Header";
import { GreenButton } from "../../src/components/GreenButton";
import { useApp } from "../../src/context/AppContext";

const CHECK_ROWS: {
  key: "vehiclePresent" | "plateMatched" | "violationConfirmed" | "restrictionVerified";
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  scan?: boolean;
}[] = [
  { key: "vehiclePresent", icon: "car", title: "Vehicle still present", body: "The vehicle is still at the location" },
  { key: "plateMatched", icon: "pricetag", title: "License plate matches", body: "License plate matches the report", scan: true },
  { key: "violationConfirmed", icon: "checkmark-circle-outline", title: "Violation confirmed", body: "The parking violation is still ongoing" },
  { key: "restrictionVerified", icon: "flag-outline", title: "Parking restriction verified", body: "Parking rules at the location confirmed" },
];

const PHOTO_TARGETS = [
  { key: "overview", label: "Vehicle overview" },
  { key: "plate", label: "License plate" },
  { key: "sign", label: "Parking sign" },
  { key: "context", label: "Violation context" },
] as const;

export default function OnSiteInspection() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { officerCases, getInspection, updateInspection } = useApp();
  const c = officerCases.find((x) => x.id === id);
  if (!c) return null;
  const officerDraft = getInspection(c.id);

  const checksCompleted = CHECK_ROWS.filter((r) => officerDraft[r.key] === true).length;
  const photosCompleted = Object.values(officerDraft.officerPhotos).filter(Boolean).length;
  const totalCompleted = checksCompleted + (photosCompleted === 4 ? 1 : 0);
  const canContinue = checksCompleted === CHECK_ROWS.length && photosCompleted === 4;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <BackHeader
        title="On-Site Inspection"
        subtitle="Verify the violation and capture evidence"
        onBack={() => router.push({ pathname: "/officer/en-route", params: { id: c.id } })}
      />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 140, gap: 16 }}>
        <View style={styles.locationBar}>
          <Ionicons name="location" size={15} color={colors.greenDark} />
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={styles.locationTitle}>{c.location}</Text>
            <Text style={styles.locationSub}>#{c.reportId}</Text>
          </View>
          <View style={styles.plateChip}>
            <Text style={styles.plateChipLabel}>{c.plate}</Text>
          </View>
        </View>

        <View>
          <Image source={{ uri: c.images[0] }} style={styles.mainImage} />
          <View style={styles.imageCounter}>
            <Text style={styles.imageCounterLabel}>1 / {c.images.length}</Text>
          </View>
        </View>

        <View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 10 }}>
            <Text style={styles.sectionTitle}>Inspection Checklist</Text>
            <Text style={styles.completedLabel}>
              <Text style={{ color: colors.greenDark }}>{checksCompleted}</Text> / {CHECK_ROWS.length} completed
            </Text>
          </View>
          {CHECK_ROWS.map((row) => {
            const done = officerDraft[row.key] === true;
            return (
              <Pressable
                key={row.key}
                style={[styles.checkRow, done && styles.checkRowDone]}
                onPress={() => updateInspection(c.id, { [row.key]: true })}
              >
                <Ionicons name={row.icon} size={20} color={done ? "#06210F" : colors.textSecondary} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[styles.checkTitle, done && { color: "#06210F" }]}>{row.title}</Text>
                  <Text style={[styles.checkBody, done && { color: "#0B3D22" }]}>{row.body}</Text>
                </View>
                {row.scan && !done ? (
                  <View style={styles.scanBtn}>
                    <Text style={styles.scanLabel}>Scan</Text>
                  </View>
                ) : (
                  <Ionicons name={done ? "checkmark-circle" : "ellipse-outline"} size={22} color={done ? "#06210F" : colors.border} />
                )}
              </Pressable>
            );
          })}
        </View>

        <View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 10 }}>
            <Text style={styles.sectionTitle}>Officer Photos</Text>
            <Text style={styles.completedLabel}>
              <Text style={{ color: colors.greenDark }}>{photosCompleted}</Text> / 4 completed
            </Text>
          </View>
          <View style={styles.photoGrid}>
            {PHOTO_TARGETS.map((t) => {
              const uri = officerDraft.officerPhotos[t.key];
              return (
                <Pressable
                  key={t.key}
                  style={[styles.photoSlot, uri && styles.photoSlotDone]}
                  onPress={() =>
                    router.push({
                      pathname: "/officer/violation-photo",
                      params: { id: c.id, target: t.key, label: t.label },
                    })
                  }
                >
                  {uri ? (
                    <Image source={{ uri }} style={StyleSheet.absoluteFillObject as any} />
                  ) : (
                    <Ionicons name="camera-outline" size={22} color={colors.greenDark} />
                  )}
                  <Text style={[styles.photoLabel, uri && styles.photoLabelDone]} numberOfLines={1}>
                    {t.label}
                  </Text>
                  {!uri && <Text style={styles.requiredLabel}>Required</Text>}
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>
      <View style={styles.bottomBar}>
        <GreenButton
          label="Continue"
          disabled={!canContinue}
          onPress={() => router.push({ pathname: "/officer/inspection-result", params: { id: c.id } })}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  locationBar: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 14 },
  locationTitle: { fontWeight: "700", fontSize: 14 },
  locationSub: { fontSize: 11.5, color: colors.textSecondary, marginTop: 2 },
  plateChip: { backgroundColor: colors.green, borderRadius: radius.chip, paddingHorizontal: 12, paddingVertical: 6 },
  plateChipLabel: { fontWeight: "800", color: "#06210F" },
  mainImage: { width: "100%", height: 200, borderRadius: radius.card },
  imageCounter: { position: "absolute", left: 10, bottom: 10, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: radius.chip, paddingHorizontal: 10, paddingVertical: 4 },
  imageCounterLabel: { color: "#fff", fontWeight: "700", fontSize: 11.5 },
  sectionTitle: { fontSize: 17, fontWeight: "800" },
  completedLabel: { fontSize: 12.5, color: colors.textSecondary, fontWeight: "600" },
  checkRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 14, marginBottom: 10 },
  checkRowDone: { backgroundColor: colors.green, borderColor: colors.green },
  checkTitle: { fontWeight: "700", fontSize: 14 },
  checkBody: { fontSize: 11.5, color: colors.textSecondary, marginTop: 2 },
  scanBtn: { borderWidth: 1.5, borderColor: colors.greenDark, borderRadius: radius.chip, paddingHorizontal: 12, paddingVertical: 6 },
  scanLabel: { color: colors.greenDark, fontWeight: "700", fontSize: 12 },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  photoSlot: {
    width: "47%",
    aspectRatio: 1,
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    overflow: "hidden",
    backgroundColor: colors.backgroundSunk,
  },
  photoSlotDone: { borderStyle: "solid", borderColor: colors.green },
  photoLabel: { fontWeight: "700", fontSize: 12, textAlign: "center", position: "absolute", bottom: 20 },
  photoLabelDone: { color: "#fff", backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 6, borderRadius: 6 },
  requiredLabel: { fontSize: 10, color: colors.textLight, position: "absolute", bottom: 6 },
  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 20, backgroundColor: colors.background },
});
