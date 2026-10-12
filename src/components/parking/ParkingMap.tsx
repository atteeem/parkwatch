import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../constants/colors";
import { ParkingMapProps } from "./parkingMap.types";

// WEB DEVELOPMENT FALLBACK ONLY. iOS/Android load ParkingMap.native.tsx (real
// react-native-maps). Here the demo areas are placed at their relative
// positions (no map tiles) so the flow can be exercised in a browser.
export function ParkingMap({ zones, selectedZoneId, onZonePress, userFix, bottomInset = 0, topInset = 0, style }: ParkingMapProps) {
  const points = [...zones.map((z) => z.center), ...(userFix ? [userFix] : [])];
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const pos = (p: { latitude: number; longitude: number }) => ({
    left: `${10 + (maxLng > minLng ? (p.longitude - minLng) / (maxLng - minLng) : 0.5) * 80}%` as const,
    top: `${18 + (maxLat > minLat ? (maxLat - p.latitude) / (maxLat - minLat) : 0.5) * 66}%` as const,
  });

  return (
    <View style={[styles.wrap, style]}>
      <View style={[styles.area, { top: topInset, bottom: bottomInset }]}>
        {zones.map((z) => {
          const sel = z.id === selectedZoneId;
          return (
            <Pressable
              key={z.id}
              onPress={() => onZonePress?.(z.id)}
              accessibilityRole="button"
              accessibilityLabel={`Area ${z.id}, ${z.name}${sel ? ", selected" : ""}`}
              style={[styles.zone, sel && styles.zoneSelected, pos(z.center)]}
            >
              <View style={[styles.badge, sel && styles.badgeSelected]}>
                <Text style={[styles.badgeText, sel && styles.badgeTextSelected]}>{z.id}</Text>
              </View>
            </Pressable>
          );
        })}
        {userFix && <View style={[styles.userDot, pos(userFix)]} />}
      </View>
      <View style={[styles.notice, { top: topInset + 2 }]}>
        <Ionicons name="phone-portrait-outline" size={13} color={colors.textSecondary} />
        <Text style={styles.noticeText}>Map preview · demo areas (live map runs in the mobile app)</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: "hidden", backgroundColor: "#E8EFEA" },
  area: { position: "absolute", left: 0, right: 0 },
  zone: {
    position: "absolute",
    width: 96,
    height: 64,
    marginLeft: -48,
    marginTop: -32,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "rgba(24,184,62,0.55)",
    backgroundColor: "rgba(92,245,138,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  zoneSelected: { borderWidth: 3, borderColor: colors.greenDark, backgroundColor: "rgba(92,245,138,0.38)" },
  badge: { minWidth: 38, height: 30, paddingHorizontal: 8, borderRadius: 15, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.greenDark, alignItems: "center", justifyContent: "center" },
  badgeSelected: { backgroundColor: colors.cardBlack, borderColor: colors.white },
  badgeText: { fontWeight: "800", fontSize: 13, color: colors.textPrimary },
  badgeTextSelected: { color: colors.white },
  userDot: { position: "absolute", width: 16, height: 16, marginLeft: -8, marginTop: -8, borderRadius: 8, backgroundColor: "#3478E5", borderWidth: 3, borderColor: "#fff" },
  notice: { position: "absolute", left: 8, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.85)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  noticeText: { fontSize: 10.5, color: colors.textSecondary, fontWeight: "600" },
});
