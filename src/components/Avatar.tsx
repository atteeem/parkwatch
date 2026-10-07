import React from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { colors } from "../constants/colors";

/**
 * Profile picture when one is set (signed URL / local image), otherwise neutral
 * initials. `onError` receives the URL that failed (e.g. an expired signed URL).
 */
export function Avatar({ name, size = 52, uri, onError }: { name: string; size?: number; uri?: string; onError?: (uri: string) => void }) {
  if (uri) {
    return (
      <Image
        source={{ uri }}
        onError={onError ? () => onError(uri) : undefined}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.greenLight }}
        accessibilityLabel={`${name}, profile photo`}
      />
    );
  }
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]} accessibilityLabel={name}>
      <Text style={[styles.text, { fontSize: size * 0.36 }]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { backgroundColor: colors.greenLight, alignItems: "center", justifyContent: "center" },
  text: { fontWeight: "800", color: colors.greenDark },
});
