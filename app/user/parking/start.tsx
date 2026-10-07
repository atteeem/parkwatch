import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../../src/constants/colors";
import { radius, shadow } from "../../../src/constants/spacing";
import { BackHeader } from "../../../src/components/Header";
import { GreenButton } from "../../../src/components/GreenButton";
import { useApp } from "../../../src/context/AppContext";
import { useNow } from "../../../src/hooks/useNow";
import { DEMO_PARKING_ZONES } from "../../../src/domain";
import { describeDomainError } from "../../../src/presentation/errors";
import { createSubmitGuard } from "../../../src/presentation/submitGuard";
import {
  clampCustomDuration,
  CUSTOM_DURATION_STEP_MINUTES,
  formatDurationMinutes,
  PARKING_DURATION_PRESETS,
  parkingQuote,
} from "../../../src/presentation/parkingViews";

type DurationChoice = { kind: "preset"; minutes: number } | { kind: "custom" };

// Start Parking: vehicle -> zone -> duration -> summary -> start a SIMULATED
// local session (no provider call, no payment).
export default function StartParking() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { vehicles, activeParking, startParking } = useApp();
  const now = useNow(30_000);
  const [chosenVehicleId, setChosenVehicleId] = useState<string | null>(null);
  const [zoneId, setZoneId] = useState(DEMO_PARKING_ZONES[0].id);
  const [choice, setChoice] = useState<DurationChoice>({ kind: "preset", minutes: 60 });
  const [customMinutes, setCustomMinutes] = useState(90);
  const [error, setError] = useState<string | null>(null);
  const guard = useMemo(() => createSubmitGuard(), []);
  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/user/parking"));

  // Preselect: the chosen vehicle if it still exists, else the default (last used / only one).
  const vehicleId =
    (chosenVehicleId && vehicles.some((v) => v.id === chosenVehicleId) ? chosenVehicleId : undefined) ??
    vehicles.find((v) => v.isDefault)?.id;
  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const zone = DEMO_PARKING_ZONES.find((z) => z.id === zoneId)!;
  const minutes = choice.kind === "custom" ? customMinutes : choice.minutes;
  const quote = parkingQuote(minutes, now);

  if (activeParking) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <BackHeader title="Start Parking" onBack={goBack} />
        <View style={styles.stateBox}>
          <Ionicons name="time-outline" size={30} color={colors.greenDark} />
          <Text style={styles.stateTitle}>Parking is already active</Text>
          <Text style={styles.stateText}>{activeParking.plate.raw} is parked. Extend or end that session before starting a new one.</Text>
          <GreenButton label="View active parking" small style={{ marginTop: 16 }} onPress={goBack} />
        </View>
      </SafeAreaView>
    );
  }

  if (vehicles.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <BackHeader title="Start Parking" onBack={goBack} />
        <View style={styles.stateBox}>
          <Ionicons name="car-outline" size={30} color={colors.greenDark} />
          <Text style={styles.stateTitle}>Add a vehicle first</Text>
          <Text style={styles.stateText}>Register the vehicle you want to park. You will come straight back here.</Text>
          <GreenButton label="Add Vehicle" small style={{ marginTop: 16 }} onPress={() => router.push("/user/parking/add-vehicle")} />
        </View>
      </SafeAreaView>
    );
  }

  const handleStart = () => {
    if (!vehicle) return;
    setError(null);
    guard.run(() => startParking(vehicle.id, zone.id, minutes), {
      onSuccess: goBack,
      onError: (e) => setError(describeDomainError(e).message),
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <BackHeader title="Start Parking" subtitle="Choose vehicle, zone and duration" onBack={goBack} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 140 + insets.bottom, gap: 18 }}>
        <View>
          <Text style={styles.sectionTitle}>Vehicle</Text>
          {vehicles.map((v) => {
            const selected = v.id === vehicleId;
            return (
              <Pressable
                key={v.id}
                style={[styles.option, selected && styles.optionSelected]}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => setChosenVehicleId(v.id)}
              >
                <Ionicons name="car" size={20} color={selected ? colors.greenDark : colors.textSecondary} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.optionTitle}>{v.plate}</Text>
                  {!!(v.title || v.color) && <Text style={styles.optionSub}>{[v.title, v.color].filter(Boolean).join(" · ")}</Text>}
                </View>
                <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={20} color={selected ? colors.greenDark : colors.border} />
              </Pressable>
            );
          })}
          <Pressable onPress={() => router.push("/user/parking/add-vehicle")} style={styles.inlineLink}>
            <Ionicons name="add-circle-outline" size={16} color={colors.greenDark} />
            <Text style={styles.inlineLinkLabel}>Add another vehicle</Text>
          </Pressable>
        </View>

        <View>
          <Text style={styles.sectionTitle}>Zone</Text>
          <View style={styles.chipRow}>
            {DEMO_PARKING_ZONES.map((z) => (
              <Pressable
                key={z.id}
                style={[styles.chip, z.id === zoneId && styles.chipSelected]}
                accessibilityRole="radio"
                accessibilityState={{ checked: z.id === zoneId }}
                onPress={() => setZoneId(z.id)}
              >
                <Text style={[styles.chipLabel, z.id === zoneId && styles.chipLabelSelected]}>{z.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.helper}>
            <Ionicons name="location-outline" size={12} /> {zone.location}
          </Text>
        </View>

        <View>
          <Text style={styles.sectionTitle}>Duration</Text>
          <View style={styles.chipRow}>
            {PARKING_DURATION_PRESETS.map((p) => {
              const selected = choice.kind === "preset" && choice.minutes === p.minutes;
              return (
                <Pressable
                  key={p.minutes}
                  style={[styles.chip, selected && styles.chipSelected]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => setChoice({ kind: "preset", minutes: p.minutes })}
                >
                  <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{p.label}</Text>
                </Pressable>
              );
            })}
            <Pressable
              style={[styles.chip, choice.kind === "custom" && styles.chipSelected]}
              accessibilityRole="radio"
              accessibilityState={{ checked: choice.kind === "custom" }}
              onPress={() => setChoice({ kind: "custom" })}
            >
              <Text style={[styles.chipLabel, choice.kind === "custom" && styles.chipLabelSelected]}>Custom</Text>
            </Pressable>
          </View>
          {choice.kind === "custom" && (
            <View style={styles.stepper}>
              <Pressable
                style={styles.stepBtn}
                accessibilityLabel="Less time"
                onPress={() => setCustomMinutes((m) => clampCustomDuration(m - CUSTOM_DURATION_STEP_MINUTES))}
              >
                <Ionicons name="remove" size={20} color={colors.greenDark} />
              </Pressable>
              <View style={{ alignItems: "center", flex: 1 }}>
                <Text style={styles.stepValue}>{formatDurationMinutes(customMinutes)}</Text>
                <Text style={styles.helper}>Ends at {quote.endText}</Text>
              </View>
              <Pressable
                style={styles.stepBtn}
                accessibilityLabel="More time"
                onPress={() => setCustomMinutes((m) => clampCustomDuration(m + CUSTOM_DURATION_STEP_MINUTES))}
              >
                <Ionicons name="add" size={20} color={colors.greenDark} />
              </Pressable>
            </View>
          )}
        </View>

        <View style={styles.summary}>
          <Text style={styles.sectionTitle}>Summary</Text>
          {[
            ["Vehicle", vehicle ? [vehicle.plate, vehicle.title].filter(Boolean).join(" · ") : "Choose a vehicle"],
            ["Zone", `${zone.label} · ${zone.location}`],
            ["Duration", quote.durationText],
            ["Starts", `Now (${quote.startText})`],
            ["Ends", quote.endText],
            ["Estimated cost", quote.estimateText],
          ].map(([k, v]) => (
            <View key={k} style={styles.summaryRow}>
              <Text style={styles.summaryKey}>{k}</Text>
              <Text style={styles.summaryValue}>{v}</Text>
            </View>
          ))}
          <Text style={styles.helper}>{quote.rateText}. Simulated parking: no payment is taken.</Text>
        </View>
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
        {error && <Text style={styles.errorText}>{error}</Text>}
        <GreenButton label="Start Parking" icon="pricetag" trailingIcon={null} disabled={!vehicle} onPress={handleStart} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  stateBox: { alignItems: "center", padding: 32 },
  stateTitle: { fontSize: 17, fontWeight: "800", marginTop: 10 },
  stateText: { fontSize: 13.5, color: colors.textSecondary, textAlign: "center", marginTop: 6 },
  sectionTitle: { fontSize: 16, fontWeight: "800", marginBottom: 10 },
  option: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 14, marginBottom: 10, backgroundColor: colors.white },
  optionSelected: { borderColor: colors.green, borderWidth: 1.5, backgroundColor: colors.greenLight },
  optionTitle: { fontWeight: "800", fontSize: 15 },
  optionSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  inlineLink: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 },
  inlineLinkLabel: { color: colors.greenDark, fontWeight: "700", fontSize: 13 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.chip, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.white },
  chipSelected: { backgroundColor: colors.green, borderColor: colors.green },
  chipLabel: { fontWeight: "700", fontSize: 13, color: colors.textPrimary },
  chipLabelSelected: { color: "#06210F" },
  helper: { fontSize: 12, color: colors.textSecondary, marginTop: 8 },
  stepper: { flexDirection: "row", alignItems: "center", marginTop: 12, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 10, backgroundColor: colors.white },
  stepBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.greenLight, alignItems: "center", justifyContent: "center" },
  stepValue: { fontSize: 20, fontWeight: "800" },
  summary: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 16, ...shadow.card },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, gap: 12 },
  summaryKey: { fontSize: 13, color: colors.textSecondary },
  summaryValue: { fontSize: 13, fontWeight: "700", flexShrink: 1, textAlign: "right" },
  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 12, backgroundColor: colors.background },
  errorText: { color: "#B3261E", fontSize: 12.5, fontWeight: "600", textAlign: "center", marginBottom: 8 },
});
