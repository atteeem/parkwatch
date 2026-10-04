import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, TextInput, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors } from "../../../src/constants/colors";
import { radius } from "../../../src/constants/spacing";
import { BackHeader } from "../../../src/components/Header";
import { GreenButton } from "../../../src/components/GreenButton";
import { useApp } from "../../../src/context/AppContext";
import { normalizePlate } from "../../../src/domain";
import { describeDomainError } from "../../../src/presentation/errors";
import { createSubmitGuard } from "../../../src/presentation/submitGuard";

// Add Vehicle: licence plate (required) + optional make, model, colour.
// Plates are compared by their normalized form, so "ABC-123" and "abc 123"
// are the same vehicle. No registry lookup or ownership check yet.
export default function AddVehicle() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { addVehicle } = useApp();
  const [plate, setPlate] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [color, setColor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const guard = useMemo(() => createSubmitGuard(), []);
  // Back returns to wherever Add Vehicle was opened from (My Vehicles, Parking, or Start Parking).
  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/user/parking/vehicles"));

  const save = () => {
    setError(null);
    guard.run(() => addVehicle({ plate, make, model, color }), {
      onSuccess: goBack,
      onError: (e) => setError(describeDomainError(e).message),
    });
  };

  const field = (label: string, value: string, onChange: (s: string) => void, placeholder: string, opts: { caps?: boolean } = {}) => (
    <View style={{ marginBottom: 16 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textLight}
        autoCapitalize={opts.caps ? "characters" : "words"}
        autoCorrect={false}
        accessibilityLabel={label}
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <BackHeader title="Add Vehicle" onBack={goBack} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 140 + insets.bottom }} keyboardShouldPersistTaps="handled">
          {field("Licence plate *", plate, (s) => {
            setPlate(s);
            setError(null);
          }, "e.g. ABC-123", { caps: true })}
          {!!normalizePlate(plate) && <Text style={styles.hint}>Saved as {normalizePlate(plate)} (Finland)</Text>}
          {error && <Text style={styles.error}>{error}</Text>}
          {field("Make", make, setMake, "e.g. Volvo")}
          {field("Model", model, setModel, "e.g. XC60")}
          {field("Colour", color, setColor, "e.g. Black")}
          <Text style={styles.note}>Only the licence plate is required. ParkWatch does not check vehicle registration yet.</Text>
        </ScrollView>
        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
          <GreenButton label="Save Vehicle" icon="checkmark-circle" trailingIcon={null} disabled={!plate.trim()} onPress={save} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  label: { fontWeight: "800", fontSize: 13.5, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, backgroundColor: colors.white },
  hint: { fontSize: 12, color: colors.textSecondary, marginTop: -10, marginBottom: 14 },
  error: { fontSize: 12.5, color: "#B3261E", fontWeight: "600", marginTop: -8, marginBottom: 14 },
  note: { fontSize: 12, color: colors.textLight },
  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 12, backgroundColor: colors.background },
});
