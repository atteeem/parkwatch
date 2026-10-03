import React, { useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Dimensions } from "react-native";
import { CameraView, useCameraPermissions, CameraType } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../constants/colors";
import { radius } from "../constants/spacing";

export type CaptureSlot = { key: string; label: string; done: boolean };

type Props = {
  headerTitle: string;
  stepper?: React.ReactNode;
  instructionTitle: string;
  instructionBody: string;
  slots: CaptureSlot[];
  onCapturePhoto: (slotKey: string, uri: string) => void;
  onContinue: () => void;
  onClose: () => void;
  continueLabel?: string;
};

export function CameraCapture({
  headerTitle,
  stepper,
  instructionTitle,
  instructionBody,
  slots,
  onCapturePhoto,
  onContinue,
  onClose,
  continueLabel = "Next",
}: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing] = useState<CameraType>("back");
  const [flash, setFlash] = useState<"off" | "on">("off");
  const cameraRef = useRef<CameraView>(null);

  const nextSlot = slots.find((s) => !s.done);
  const allDone = slots.every((s) => s.done);

  const handleShutter = async () => {
    if (!cameraRef.current || !nextSlot) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.6 });
      if (photo?.uri) onCapturePhoto(nextSlot.key, photo.uri);
    } catch (e) {
      // Camera can fail in some simulators — fall back to a placeholder
      // capture so the demo flow never gets stuck.
      onCapturePhoto(nextSlot.key, "https://picsum.photos/seed/" + nextSlot.key + "/500/500");
    }
  };

  if (!permission) {
    return <View style={styles.fill} />;
  }

  if (!permission.granted) {
    return (
      <View style={[styles.fill, styles.permissionWrap]}>
        <Ionicons name="camera-outline" size={40} color={colors.textSecondary} />
        <Text style={styles.permissionTitle}>Camera access needed</Text>
        <Text style={styles.permissionBody}>
          ParkWatch needs your camera to capture evidence photos for this report.
        </Text>
        <Pressable style={styles.permissionBtn} onPress={requestPermission}>
          <Text style={styles.permissionBtnLabel}>Enable camera</Text>
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

      <View style={styles.overlayTop}>
        <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={10}>
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

      <View style={styles.spacer} />

      <View style={styles.slotsRow}>
        {slots.map((s) => (
          <View key={s.key} style={[styles.slotCard, s.done && styles.slotCardDone]}>
            {s.done ? (
              <Ionicons name="checkmark-circle" size={22} color={colors.green} />
            ) : (
              <Ionicons name="car-outline" size={22} color="#fff" />
            )}
            <Text style={[styles.slotLabel, s.done && { color: colors.green }]} numberOfLines={1}>
              {s.done ? "Captured" : s.label}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.bottomControls}>
        <Pressable
          style={styles.sideControl}
          onPress={() => setFlash((f) => (f === "off" ? "on" : "off"))}
          hitSlop={10}
        >
          <Ionicons name={flash === "on" ? "flash" : "flash-off"} size={22} color="#fff" />
        </Pressable>

        <Pressable style={styles.shutter} onPress={handleShutter} disabled={!nextSlot}>
          <View style={styles.shutterInner} />
        </Pressable>

        <Pressable
          style={[styles.sideControl, !allDone && { opacity: 0.35 }]}
          onPress={allDone ? onContinue : undefined}
          hitSlop={10}
        >
          <Ionicons name="arrow-forward" size={22} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

const { width } = Dimensions.get("window");

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: "#000" },
  permissionWrap: { alignItems: "center", justifyContent: "center", padding: 32 },
  permissionTitle: { fontSize: 18, fontWeight: "700", color: "#fff", marginTop: 14 },
  permissionBody: { fontSize: 13.5, color: "#B9C1BB", textAlign: "center", marginTop: 8 },
  permissionBtn: { marginTop: 20, backgroundColor: colors.green, borderRadius: radius.button, paddingVertical: 14, paddingHorizontal: 24 },
  permissionBtnLabel: { color: "#06210F", fontWeight: "700", fontSize: 15 },

  overlayTop: {
    marginTop: 54,
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

  spacer: { flex: 1 },

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
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  slotCardDone: {
    borderStyle: "solid",
    borderColor: colors.green,
    backgroundColor: "rgba(23,201,100,0.18)",
  },
  slotLabel: { color: "#fff", fontSize: 11, fontWeight: "700" },

  bottomControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 40,
    paddingBottom: 44,
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
