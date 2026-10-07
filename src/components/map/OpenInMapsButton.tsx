import React, { useState } from "react";
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../constants/colors";
import { radius } from "../../constants/spacing";
import { isValidMapsPoint, MapsPoint, openInExternalMaps } from "../../map/externalMaps";

/** Opens the case location in the phone's maps app. Renders nothing without a real point. */
export function OpenInMapsButton({ point, label, style, dark }: { point?: MapsPoint; label: string; style?: StyleProp<ViewStyle>; dark?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!isValidMapsPoint(point)) return null;
  return (
    <View style={style}>
      <Pressable
        onPress={() => void openInExternalMaps(point, label).then((ok) => setFailed(!ok))}
        style={[styles.btn, dark && styles.btnDark]}
        hitSlop={6}
        accessibilityRole="link"
        accessibilityLabel="Open in Maps"
        accessibilityHint="Opens this location in your phone's maps app"
      >
        <Ionicons name="open-outline" size={13} color={dark ? "#fff" : colors.greenDark} />
        <Text style={[styles.label, dark && { color: "#fff" }]}>Open in Maps</Text>
      </Pressable>
      {failed ? <Text style={styles.error}>No maps app could be opened.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 32, paddingHorizontal: 12, borderRadius: radius.chip, borderWidth: 1.5, borderColor: colors.greenDark, alignSelf: "flex-start" },
  btnDark: { borderColor: "rgba(255,255,255,0.6)" },
  label: { fontSize: 12.5, fontWeight: "800", color: colors.greenDark },
  error: { fontSize: 11.5, color: "#B3261E", marginTop: 4, fontWeight: "600" },
});
