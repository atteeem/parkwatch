import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../constants/colors";
import { radius } from "../../constants/spacing";
import { Card } from "../Card";
import { useReportDraft } from "../../context/ReportContext";
import { useApp } from "../../context/AppContext";
import { plateFieldValue, sanitizePlateInput } from "../../presentation/plateEntry";
import { PlateScanner } from "./PlateScanner";

/**
 * Licence plate on Add Details: a plain text field (always available) and
 * "Scan registration plate". A scan only proposes a plate; it goes into the
 * report when the citizen confirms it, edits it or types it.
 */
export function PlateEntryCard() {
  const { draft, setPlate } = useReportDraft();
  const { plateRecognizer } = useApp();
  const [text, setText] = useState(plateFieldValue(draft));
  const [scanning, setScanning] = useState(false);
  const input = useRef<TextInput>(null);

  // Keep the field in step if the draft changes elsewhere (e.g. a restored draft).
  const saved = plateFieldValue(draft);
  useEffect(() => {
    if (sanitizePlateInput(text).trim() !== saved) setText(saved);
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (t: string) => {
    const clean = sanitizePlateInput(t);
    setText(clean);
    setPlate(clean);
  };

  return (
    <Card>
      <Text style={styles.title}>Licence plate</Text>
      <View style={styles.row}>
        <TextInput
          ref={input}
          value={text}
          onChangeText={change}
          placeholder="e.g. ABC-123"
          placeholderTextColor={colors.textLight}
          autoCapitalize="characters"
          autoCorrect={false}
          style={styles.input}
          accessibilityLabel="Licence plate"
        />
      </View>
      <Pressable onPress={() => setScanning(true)} style={styles.scan} accessibilityRole="button" accessibilityLabel="Scan registration plate">
        <Ionicons name="scan-outline" size={18} color={colors.greenDark} />
        <Text style={styles.scanLabel}>Scan registration plate</Text>
      </Pressable>
      <Text style={styles.help}>
        {plateRecognizer ? "Scan reads the plate for you to check and confirm. You can always type or correct it." : "Type the plate as it appears on the vehicle."}
      </Text>
      <PlateScanner
        visible={scanning}
        initialPlate={text}
        recognize={plateRecognizer}
        onUsePlate={(p) => {
          change(p);
          setScanning(false);
        }}
        onEnterManually={() => {
          setScanning(false);
          setTimeout(() => input.current?.focus(), 350);
        }}
        onClose={() => setScanning(false)}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 16, fontWeight: "800", marginBottom: 10 },
  row: { flexDirection: "row" },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 1,
    color: colors.textPrimary,
  },
  scan: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", marginTop: 12, paddingVertical: 6 },
  scanLabel: { color: colors.greenDark, fontWeight: "800", fontSize: 14 },
  help: { fontSize: 12, color: colors.textSecondary, marginTop: 6, lineHeight: 16 },
});
