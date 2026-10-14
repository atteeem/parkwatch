import React, { useReducer, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../constants/colors";
import { PLATE_ASPECT, sanitizePlateInput } from "../../presentation/plateEntry";
import { INITIAL_SCAN, PlateRecognizer, SCAN_COPY, SCAN_FAILURE_COPY, scanReducer, ScanState } from "../../presentation/plateScanFlow";
import { useDeviceLevel } from "../../sensors/useDeviceLevel";
import { capturePlateCrop, PlateCrop } from "./capturePlateCrop";
import type { Rect } from "../../presentation/plateCrop";

export const PLATE_SCAN_TITLE = "Scan registration plate";
export const PLATE_SCAN_INSTRUCTION = SCAN_COPY.aim;

/** Plate target size for a screen: wide, plate-proportioned, never wider than the screen margins. */
export function plateTargetSize(screenWidth: number): { width: number; height: number } {
  const width = Math.round(Math.min(screenWidth - 48, 420));
  return { width, height: Math.round(width / PLATE_ASPECT) };
}

export type CaptureCrop = (camera: CameraView, view: { width: number; height: number }, frame: Rect) => Promise<PlateCrop | null>;

/**
 * Plate scanner: live camera with a plate-shaped target. "Scan plate" sends a
 * small crop of the frame to ParkWatch's recognition service; the result is
 * only a proposal - the citizen confirms ("Use NNC-685"), edits, picks between
 * close readings, or types the plate. Without recognition (local demo / no
 * connection) it is a framing aid with manual entry.
 */
export function PlateScanner({
  visible,
  initialPlate,
  recognize,
  onUsePlate,
  onEnterManually,
  onClose,
  capture = capturePlateCrop,
}: {
  visible: boolean;
  initialPlate: string;
  recognize: PlateRecognizer | null;
  onUsePlate: (plate: string) => void;
  onEnterManually: () => void;
  onClose: () => void;
  capture?: CaptureCrop;
}) {
  const insets = useSafeAreaInsets();
  const { width: sw, height: sh } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const startState = (): ScanState => (recognize ? INITIAL_SCAN : { step: "edit", text: initialPlate });
  const [state, dispatch] = useReducer(scanReducer, undefined, startState);
  const [cameraReady, setCameraReady] = useState(false);
  const camera = useRef<CameraView>(null);
  const level = useDeviceLevel(visible);
  const target = plateTargetSize(sw);
  const top = Math.round(sh * 0.24);
  const left = Math.round((sw - target.width) / 2);
  const granted = permission?.granted === true;

  const scan = async () => {
    if (!recognize || state.step === "reading") return;
    dispatch({ type: "SCAN" });
    const crop = camera.current ? await capture(camera.current, { width: sw, height: sh }, { x: left, y: top, width: target.width, height: target.height }) : null;
    if (!crop) {
      dispatch({ type: "OUTCOME", outcome: { ok: false, error: "CAPTURE_FAILED" } });
      return;
    }
    dispatch({ type: "OUTCOME", outcome: await recognize(crop) });
  };

  const tilted = level.status === "tilted" || level.status === "notUpright";
  const instruction = state.step === "reading" ? SCAN_COPY.reading : SCAN_COPY.aim;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      onShow={() => dispatch(recognize ? { type: "RETRY" } : { type: "EDIT", text: initialPlate })}
    >
      <View style={styles.root}>
        {granted ? <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" onCameraReady={() => setCameraReady(true)} /> : null}

        {/* darkened surround: four bands around the target */}
        <View pointerEvents="none" style={[styles.mask, { top: 0, left: 0, right: 0, height: top }]} />
        <View pointerEvents="none" style={[styles.mask, { top: top + target.height, left: 0, right: 0, bottom: 0 }]} />
        <View pointerEvents="none" style={[styles.mask, { top, left: 0, width: left, height: target.height }]} />
        <View pointerEvents="none" style={[styles.mask, { top, right: 0, width: sw - left - target.width, height: target.height }]} />

        <View pointerEvents="none" style={[styles.target, { top, left, width: target.width, height: target.height }]} testID="plate-target">
          {(["tl", "tr", "bl", "br"] as const).map((c) => (
            <View key={c} style={[styles.corner, cornerStyle[c]]} />
          ))}
        </View>
        <View pointerEvents="none" style={[styles.under, { top: top + target.height + 14 }]}>
          <Text style={styles.instruction} accessibilityLiveRegion="polite">
            {instruction}
          </Text>
          {tilted && recognize ? <Text style={styles.tilted}>{SCAN_COPY.tilted}</Text> : null}
        </View>

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
              {permission?.canAskAgain === false ? "Camera access is off for ParkWatch. You can still type the plate." : "Allow the camera to see the plate in the frame."}
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
            <Panel
              state={state}
              canScan={!!recognize && granted && cameraReady}
              hasRecognition={!!recognize}
              onScan={scan}
              onUsePlate={onUsePlate}
              onEdit={(text) => dispatch({ type: "EDIT", text })}
              onRetry={() => dispatch({ type: "RETRY" })}
              onEnterManually={onEnterManually}
            />
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function Panel({
  state,
  canScan,
  hasRecognition,
  onScan,
  onUsePlate,
  onEdit,
  onRetry,
  onEnterManually,
}: {
  state: ScanState;
  canScan: boolean;
  hasRecognition: boolean;
  onScan: () => void;
  onUsePlate: (plate: string) => void;
  onEdit: (text: string) => void;
  onRetry: () => void;
  onEnterManually: () => void;
}) {
  const manual = <Link label="Enter manually" onPress={onEnterManually} />;
  switch (state.step) {
    case "aim":
      return (
        <>
          <Primary label="Scan plate" icon="scan" onPress={onScan} disabled={!canScan} />
          {manual}
        </>
      );
    case "reading":
      return (
        <View style={styles.reading} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colors.greenDark} />
          <Text style={styles.readingText}>{SCAN_COPY.reading}</Text>
        </View>
      );
    case "result":
      return (
        <>
          <Text style={[styles.resultLabel, state.tier === "medium" && styles.resultCheck]}>{state.tier === "high" ? SCAN_COPY.resultHigh : SCAN_COPY.resultMedium}</Text>
          <Text style={styles.plate} accessibilityLabel={`Plate ${state.plate}`}>
            {state.plate}
          </Text>
          <Primary label={`Use ${state.plate}`} onPress={() => onUsePlate(state.plate)} />
          <View style={styles.row}>
            <Link label="Edit" onPress={() => onEdit(state.plate)} />
            <Link label="Scan again" onPress={onRetry} />
          </View>
        </>
      );
    case "choose":
      return (
        <>
          <Text style={styles.resultLabel}>{SCAN_COPY.choose}</Text>
          {state.options.map((o) => (
            <Pressable key={o.normalized} onPress={() => onUsePlate(o.plate)} style={styles.option} accessibilityRole="button" accessibilityLabel={`Use ${o.plate}`}>
              <Text style={styles.optionText}>{o.plate}</Text>
            </Pressable>
          ))}
          {manual}
        </>
      );
    case "noResult":
      return (
        <>
          <Text style={styles.failTitle}>{SCAN_COPY.noResultTitle}</Text>
          <Text style={styles.failBody}>{SCAN_COPY.noResultBody}</Text>
          <Primary label="Try again" onPress={onRetry} />
          {manual}
        </>
      );
    case "failed": {
      const copy = SCAN_FAILURE_COPY[state.error];
      return (
        <>
          <Text style={styles.failTitle}>{copy.title}</Text>
          <Text style={styles.failBody}>{copy.body}</Text>
          {copy.retry ? <Primary label="Try again" onPress={onRetry} /> : null}
          {manual}
        </>
      );
    }
    case "edit":
      return (
        <>
          {!hasRecognition ? <Text style={styles.failBody}>{SCAN_COPY.unavailable}</Text> : null}
          <TextInput
            value={state.text}
            onChangeText={(t) => onEdit(sanitizePlateInput(t))}
            placeholder="e.g. ABC-123"
            placeholderTextColor={colors.textLight}
            autoCapitalize="characters"
            autoCorrect={false}
            style={styles.input}
            accessibilityLabel="Licence plate"
            returnKeyType="done"
            onSubmitEditing={() => state.text.trim() && onUsePlate(state.text)}
          />
          <Primary label="Use this plate" disabled={!state.text.trim()} onPress={() => onUsePlate(state.text)} />
          {hasRecognition ? <Link label="Scan again" onPress={onRetry} /> : null}
        </>
      );
  }
}

function Primary({ label, onPress, disabled, icon }: { label: string; onPress: () => void; disabled?: boolean; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={[styles.primary, disabled && { opacity: 0.4 }]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      accessibilityLabel={label}
    >
      {icon ? <Ionicons name={icon} size={18} color="#fff" /> : null}
      <Text style={styles.primaryLabel}>{label}</Text>
    </Pressable>
  );
}

function Link({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.secondary} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}>
      <Text style={styles.secondaryLabel}>{label}</Text>
    </Pressable>
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
  under: { position: "absolute", left: 24, right: 24, alignItems: "center", gap: 6 },
  instruction: { textAlign: "center", color: "#fff", fontSize: 14, fontWeight: "700" },
  tilted: { color: colors.amber, fontSize: 13, fontWeight: "700", textAlign: "center" },
  header: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", paddingHorizontal: 16 },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", color: "#fff", fontSize: 16, fontWeight: "800" },
  permission: { position: "absolute", left: 24, right: 24, alignItems: "center", gap: 10 },
  permissionText: { color: "#fff", fontSize: 13.5, textAlign: "center" },
  allow: { backgroundColor: colors.green, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 10 },
  allowLabel: { color: "#06210F", fontWeight: "800" },
  bottomWrap: { position: "absolute", left: 0, right: 0, bottom: 0 },
  panel: { backgroundColor: colors.white, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 16, gap: 10 },
  reading: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, minHeight: 50 },
  readingText: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
  resultLabel: { fontSize: 13, fontWeight: "700", color: colors.textSecondary, textAlign: "center" },
  resultCheck: { color: "#9A6200" },
  plate: { fontSize: 32, fontWeight: "800", letterSpacing: 2, textAlign: "center", color: colors.textPrimary },
  row: { flexDirection: "row", justifyContent: "center", gap: 28 },
  option: { borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  optionText: { fontSize: 22, fontWeight: "800", letterSpacing: 1.5, color: colors.textPrimary },
  failTitle: { fontSize: 16, fontWeight: "800", textAlign: "center", color: colors.textPrimary },
  failBody: { fontSize: 13, color: colors.textSecondary, textAlign: "center", lineHeight: 18 },
  input: { borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 20, fontWeight: "800", letterSpacing: 1.5, color: colors.textPrimary, textAlign: "center" },
  primary: { backgroundColor: colors.cardBlack, borderRadius: 14, minHeight: 50, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  primaryLabel: { color: "#fff", fontWeight: "800", fontSize: 15.5 },
  secondary: { alignItems: "center", paddingVertical: 8 },
  secondaryLabel: { color: colors.greenDark, fontWeight: "800", fontSize: 14 },
});
