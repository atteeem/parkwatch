import React, { useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Linking, Platform } from "react-native";
import { CameraView, useCameraPermissions, CameraType } from "expo-camera";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../constants/colors";
import { radius } from "../constants/spacing";
import { permissionView, takePhotoSafely } from "./cameraCapture.logic";
import { CAMERA_EDUCATION } from "../presentation/permissionEducation";
import { CameraGuideOverlay } from "./CameraGuideOverlay";
import type { CameraGuideKind } from "../presentation/cameraGuides";

export type CaptureSlot = { key: string; label: string; done: boolean; icon?: keyof typeof Ionicons.glyphMap };

type Props = {
  headerTitle: string;
  stepper?: React.ReactNode;
  instructionTitle: string;
  instructionBody: string;
  slots: CaptureSlot[];
  /** Slot the next capture goes into. Defaults to the first slot not yet done. */
  activeSlotKey?: string;
  /** Lets the user pick which angle to capture (shown as tappable slot cards). */
  onSelectSlot?: (slotKey: string) => void;
  /** Called only with a real captured photo (never a placeholder). */
  /** May return a Promise (e.g. an upload): the shutter stays locked until it settles. */
  onCapturePhoto: (slotKey: string, uri: string, capturedAt: string) => void | Promise<void>;
  onContinue: () => void;
  onClose: () => void;
  continueLabel?: string;
  /** Framing outline for the active slot (purely visual). */
  guide?: CameraGuideKind;
  /** Busy text shown on the shutter area while the parent saves (e.g. "Uploading…"). */
  busyLabel?: string;
};

export function CameraCapture({
  headerTitle,
  stepper,
  instructionTitle,
  instructionBody,
  slots,
  activeSlotKey,
  onSelectSlot,
  onCapturePhoto,
  onContinue,
  onClose,
  continueLabel = "Continue",
  guide,
  busyLabel,
}: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing] = useState<CameraType>("back");
  const [flash, setFlash] = useState<"off" | "on">("off");
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const cameraRef = useRef<CameraView>(null);
  const insets = useSafeAreaInsets();

  const activeSlot = slots.find((s) => s.key === activeSlotKey) ?? slots.find((s) => !s.done);
  const allDone = slots.every((s) => s.done);

  const handleShutter = async () => {
    if (!cameraRef.current || !activeSlot || capturing) return;
    setCapturing(true);
    setCaptureError(null);
    const outcome = await takePhotoSafely(() => cameraRef.current!.takePictureAsync({ quality: 0.6 }));
    // On failure: stay here, keep earlier photos, show the error. No fake image.
    if (outcome.ok) {
      try {
        await onCapturePhoto(activeSlot.key, outcome.uri, outcome.capturedAt);
      } finally {
        setCapturing(false);
      }
    } else {
      setCapturing(false);
      setCaptureError(outcome.message);
    }
  };

  const view = permissionView(permission);

  if (view === "loading") {
    return <View style={styles.fill} />;
  }

  if (view !== "granted") {
    const canOpenSettings = Platform.OS !== "web";
    return (
      <View style={[styles.fill, styles.permissionWrap]}>
        <Ionicons name="camera-outline" size={40} color={colors.textSecondary} />
        <Text style={styles.permissionTitle}>Camera access needed</Text>
        <Text style={styles.permissionBody}>
          {CAMERA_EDUCATION} Photos must be taken on the spot; ParkWatch only asks when you tap Allow camera.
        </Text>
        {view === "ask" ? (
          <Pressable style={styles.permissionBtn} onPress={requestPermission}>
            <Text style={styles.permissionBtnLabel}>Allow camera</Text>
          </Pressable>
        ) : (
          <>
            <Text style={styles.permissionBody}>
              {canOpenSettings
                ? "Camera access was turned off. Enable it for ParkWatch in your device settings, then try again."
                : "Camera access was blocked. Allow it in your browser's site settings, then try again."}
            </Text>
            {canOpenSettings && (
              <Pressable style={styles.permissionBtn} onPress={() => void Linking.openSettings()}>
                <Text style={styles.permissionBtnLabel}>Open settings</Text>
              </Pressable>
            )}
          </>
        )}
        <Pressable onPress={requestPermission} style={{ marginTop: 14 }}>
          <Text style={{ color: colors.green, fontWeight: "700" }}>Try again</Text>
        </Pressable>
        <Pressable onPress={onClose} style={{ marginTop: 14 }}>
          <Text style={{ color: colors.textSecondary, fontWeight: "600" }}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} enableTorch={flash === "on"} />
      {/* Behind every control: drawn before them and never takes touches. */}
      {guide && activeSlot ? <CameraGuideOverlay kind={guide} /> : null}

      <View style={[styles.overlayTop, { marginTop: insets.top + 10 }]}>
        <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close camera">
          <Ionicons name="close" size={20} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {headerTitle}
        </Text>
        <View style={{ width: 34 }} />
      </View>

      {stepper}

      <View style={styles.instructionCard}>
        <Text style={styles.instructionTitle}>{instructionTitle}</Text>
        <Text style={styles.instructionBody}>{instructionBody}</Text>
      </View>

      {captureError && (
        <Pressable style={styles.errorCard} onPress={() => setCaptureError(null)}>
          <Ionicons name="alert-circle" size={16} color="#fff" />
          <Text style={styles.errorText}>{captureError}</Text>
        </Pressable>
      )}

      <View style={styles.spacer} />

      <View style={styles.slotsRow}>
        {slots.map((s) => {
          const isActive = s.key === activeSlot?.key;
          return (
            <Pressable
              key={s.key}
              disabled={!onSelectSlot || capturing}
              onPress={() => onSelectSlot?.(s.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive, disabled: !onSelectSlot || capturing }}
              accessibilityLabel={`${s.label}, ${s.done ? (isActive ? "captured, selected for retake" : "captured") : isActive ? "next photo" : "not taken yet"}`}
              style={[styles.slotCard, s.done && styles.slotCardDone, isActive && styles.slotCardActive]}
            >
              {s.done ? (
                <Ionicons name="checkmark-circle" size={22} color={colors.green} />
              ) : (
                <Ionicons name={s.icon ?? "car-outline"} size={22} color="#fff" />
              )}
              <Text style={[styles.slotLabel, s.done && { color: colors.green }]} numberOfLines={1}>
                {s.label}
              </Text>
              <Text style={styles.slotState} numberOfLines={1}>
                {s.done ? (isActive ? "Retake" : "Captured") : "Take photo"}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {capturing && busyLabel ? <Text style={styles.busyLabel}>{busyLabel}</Text> : null}
      <View style={[styles.bottomControls, { paddingBottom: Math.max(insets.bottom, 16) + 20 }]}>
        <Pressable
          style={styles.sideControl}
          onPress={() => setFlash((f) => (f === "off" ? "on" : "off"))}
          hitSlop={10}
        >
          <Ionicons name={flash === "on" ? "flash" : "flash-off"} size={22} color="#fff" />
        </Pressable>

        <Pressable
          style={[styles.shutter, (!activeSlot || capturing) && { opacity: 0.5 }]}
          onPress={handleShutter}
          disabled={!activeSlot || capturing}
          accessibilityRole="button"
          accessibilityLabel={activeSlot ? `Take photo: ${activeSlot.label}` : "Take photo"}
          accessibilityState={{ disabled: !activeSlot || capturing, busy: capturing }}
        >
          <View style={styles.shutterInner} />
        </Pressable>

        <Pressable
          style={[styles.sideControl, !allDone && { opacity: 0.35 }]}
          onPress={allDone ? onContinue : undefined}
          disabled={!allDone}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={continueLabel}
          accessibilityState={{ disabled: !allDone }}
        >
          <Ionicons name="arrow-forward" size={22} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: "#000" },
  permissionWrap: { alignItems: "center", justifyContent: "center", padding: 32 },
  permissionTitle: { fontSize: 18, fontWeight: "700", color: "#fff", marginTop: 14 },
  permissionBody: { fontSize: 13.5, color: "#B9C1BB", textAlign: "center", marginTop: 8 },
  permissionBtn: { marginTop: 20, backgroundColor: colors.green, borderRadius: radius.button, paddingVertical: 14, paddingHorizontal: 24 },
  permissionBtnLabel: { color: "#06210F", fontWeight: "700", fontSize: 15 },

  overlayTop: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { flex: 1, textAlign: "center", color: "#fff", fontSize: 16, fontWeight: "800" },

  instructionCard: {
    marginTop: 14,
    marginHorizontal: 20,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: radius.card,
    padding: 14,
  },
  instructionTitle: { color: "#fff", fontWeight: "800", fontSize: 14 },
  instructionBody: { color: "#D8DDD9", fontSize: 12.5, marginTop: 4, lineHeight: 17 },

  errorCard: {
    marginTop: 10,
    marginHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(179,38,30,0.85)",
    borderRadius: radius.card,
    padding: 12,
  },
  errorText: { color: "#fff", fontSize: 12.5, fontWeight: "600", flex: 1 },

  spacer: { flex: 1 },

  busyLabel: { color: "#fff", fontSize: 12.5, fontWeight: "700", textAlign: "center", marginBottom: 8 },
  slotsRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  slotCard: {
    flex: 1,
    aspectRatio: 0.9,
    borderRadius: radius.photo,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.5)",
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  slotCardDone: {
    borderStyle: "solid",
    borderColor: colors.green,
    backgroundColor: "rgba(23,201,100,0.18)",
  },
  slotCardActive: { borderWidth: 2.5, borderColor: "#fff", borderStyle: "solid" },
  slotLabel: { color: "#fff", fontSize: 11, fontWeight: "700" },
  slotState: { color: "#D8DDD9", fontSize: 10, fontWeight: "600" },

  bottomControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 40,
  },
  sideControl: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  shutter: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 4,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#fff",
  },
});
