import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../constants/colors";
import { radius } from "../constants/spacing";
import { useReducedMotion } from "../hooks/useReducedMotion";
import type { AvatarSource } from "../avatar/avatarImage";

/** "Change profile photo": choose from library, take a photo, remove. */
export function AvatarEditSheet({
  visible,
  hasPhoto,
  onChoose,
  onRemove,
  onClose,
}: {
  visible: boolean;
  hasPhoto: boolean;
  onChoose: (source: AvatarSource) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const Row = ({ icon, label, onPress, danger }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; danger?: boolean }) => (
    <Pressable style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={20} color={danger ? colors.red : colors.textPrimary} />
      <Text style={[styles.rowLabel, danger && { color: colors.red }]}>{label}</Text>
    </Pressable>
  );
  return (
    <Modal visible={visible} transparent animationType={reduceMotion ? "none" : "slide"} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <Text style={styles.title} accessibilityRole="header">
          Change profile photo
        </Text>
        <Row icon="images-outline" label="Choose from library" onPress={() => onChoose("library")} />
        <Row icon="camera-outline" label="Take photo" onPress={() => onChoose("camera")} />
        {hasPhoto ? <Row icon="trash-outline" label="Remove photo" danger onPress={onRemove} /> : null}
        <Row icon="close" label="Cancel" onPress={onClose} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: radius.card + 6, borderTopRightRadius: radius.card + 6, paddingTop: 16, paddingHorizontal: 12 },
  title: { fontSize: 16, fontWeight: "800", textAlign: "center", marginBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, paddingHorizontal: 12, borderRadius: radius.button },
  rowLabel: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
});
