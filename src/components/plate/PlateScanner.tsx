import React, { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../constants/colors";
import { PLATE_ASPECT, PLATE_SCAN_NOTE, sanitizePlateInput } from "../../presentation/plateEntry";

export const PLATE_SCAN_TITLE = "Scan registration plate";
export const PLATE_SCAN_INSTRUCTION = "Position the registration plate inside the frame";

/** Plate target size for a screen: wide, plate-proportioned, never wider than the screen margins. */
export function plateTargetSize(screenWidth: number): { width: number; height: number } {
  const width = Math.round(Math.min(screenWidth - 48, 420));
  return { width, height: Math.round(width / PLATE_ASPECT) };
}

/**
 * Plate scanner view: a live camera with a plate-shaped target and a darkened
 * surround, so the citizen can frame and read the plate, then type it. There
 * is NO automatic recognition: nothing claims a plate was "detected".
 */
export function PlateScanner({
  visible,
  initialPlate,
  onUsePlate,
  onEnterManually,
  onClose,
}: {
  visible: boolean;
  initialPlate: string;
  onUsePlate: (plate: string) => void;
  onEnterManually: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width: sw, height: sh } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const [text, setText] = useState(initialPlate);
  const target = plateTargetSize(sw);
  const top = Math.round(sh * 0.26);
  const left = Math.round((sw - target.width) / 2);
  const granted = permission?.granted === true;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} onShow={() => setText(initialPlate)}>
      <View style={styles.root}>
        {granted ? <CameraView style={StyleSheet.absoluteFill} facing="back" /> : null}

        {/* darkened surround: four bands around the target */}
        <View pointerEvents="none" style={[styles.mask, { top: 0, left: 0, right: 0, height: top }]} />
        <View pointerEvents="none" style={[styles.mask, { top: top + target.height, left: 0, right: 0, bottom: 0 }]} />
        <View pointerEvents="none" style={[styles.mask, { top, left: 0, width: left, height: target.height }]} />
        <View pointerEvents="none" style={[styles.mask, { top, right: 0, width: sw - left - target.width, height: target.height }]} />

        {/* target */}
        <View pointerEvents="none" style={[styles.target, { top, left, width: target.width, height: target.height }]} testID="plate-target">
          {(["tl", "tr", "bl", "br"] as const).map((c) => (
            <View key={c} style={[styles.corner, cornerStyle[c]]} />
          ))}
        </View>
        <Text style={[styles.instruction, { top: top + target.height + 14 }]}>{PLATE_SCAN_INSTRUCTION}</Text>

        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close scanner" hitSlop={10}>
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
          <Text style={styles.title}>{PLATE_SCAN_TITLE}</Text>
          <View style={{ width: 36 }} />
        </View>

        {!granted && (
          <View style={[styles.permission, { top: Math.max(insets.top + 52, top - 84) }]}>
            <Text style={styles.permissionText}>
              {permission?.canAskAgain === false ? "Camera access is off for ParkWatch. You can still type the plate below." : "Allow the camera to see the plate in the frame."}
            </Text>
            {permission?.canAskAgain !== false && (
              <Pressable onPress={requestPermission} style={styles.allow} accessibilityRole="button">
                <Text style={styles.allowLabel}>Allow camera</Text>
              </Pressable>
            )}
          </View>
        )}

        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.bottomWrap}>
          <View style={[styles.panel, { paddingBottom: Math.max(insets.bottom, 12) + 10 }]}>
            <Text style={styles.note}>{PLATE_SCAN_NOTE}</Text>
            <TextInput
              value={text}
              onChangeText={(t) => setText(sanitizePlateInput(t))}
              placeholder="e.g. ABC-123"
              placeholderTextColor={colors.textLight}
              autoCapitalize="characters"
              autoCorrect={false}
              style={styles.input}
              accessibilityLabel="Licence plate"
              returnKeyType="done"
              onSubmitEditing={() => text.trim() && onUsePlate(text)}
            />
            <Pressable
              onPress={() => text.trim() && onUsePlate(text)}
              disabled={!text.trim()}
              style={[styles.primary, !text.trim() && { opacity: 0.4 }]}
              accessibilityRole="button"
              accessibilityState={{ disabled: !text.trim() }}
            >
              <Text style={styles.primaryLabel}>Use this plate</Text>
            </Pressable>
            <Pressable onPress={onEnterManually} style={styles.secondary} accessibilityRole="button">
              <Text style={styles.secondaryLabel}>Enter manually</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const C = 22;
const W = 3;
const cornerStyle = {
  tl: { top: -1, left: -1, borderTopWidth: W, borderLeftWidth: W, borderTopLeftRadius: 10 },
  tr: { top: -1, right: -1, borderTopWidth: W, borderRightWidth: W, borderTopRightRadius: 10 },
  bl: { bottom: -1, left: -1, borderBottomWidth: W, borderLeftWidth: W, borderBottomLeftRadius: 10 },
  br: { bottom: -1, right: -1, borderBottomWidth: W, borderRightWidth: W, borderBottomRightRadius: 10 },
} as const;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  mask: { position: "absolute", backgroundColor: "rgba(0,0,0,0.58)" },
  target: { position: "absolute", borderWidth: 1, borderColor: "rgba(255,255,255,0.45)", borderRadius: 10 },
  corner: { position: "absolute", width: C, height: C, borderColor: "#fff" },
  instruction: { position: "absolute", left: 24, right: 24, textAlign: "center", color: "#fff", fontSize: 14, fontWeight: "700" },
  header: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", paddingHorizontal: 16 },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", color: "#fff", fontSize: 16, fontWeight: "800" },
  permission: { position: "absolute", left: 24, right: 24, alignItems: "center", gap: 10 },
  permissionText: { color: "#fff", fontSize: 13.5, textAlign: "center" },
  allow: { backgroundColor: colors.green, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 10 },
  allowLabel: { color: "#06210F", fontWeight: "800" },
  bottomWrap: { position: "absolute", left: 0, right: 0, bottom: 0 },
  panel: { backgroundColor: colors.white, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 16, gap: 10 },
  note: { fontSize: 12.5, color: colors.textSecondary, lineHeight: 17 },
  input: { borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 20, fontWeight: "800", letterSpacing: 1.5, color: colors.textPrimary, textAlign: "center" },
  primary: { backgroundColor: colors.cardBlack, borderRadius: 14, minHeight: 50, alignItems: "center", justifyContent: "center" },
  primaryLabel: { color: "#fff", fontWeight: "800", fontSize: 15.5 },
  secondary: { alignItems: "center", paddingVertical: 8 },
  secondaryLabel: { color: colors.greenDark, fontWeight: "800", fontSize: 14 },
});
