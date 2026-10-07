import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../constants/colors";
import { LiveMapProps, MARKER_STYLE } from "./liveMap.types";

// WEB DEVELOPMENT FALLBACK ONLY. iOS/Android load LiveMap.native.tsx (real
// react-native-maps). react-native-maps has no web support, so on Expo Web
// we draw markers at their relative positions (no map tiles) and say so.
export function LiveMap({ markers, userFix, onMarkerPress, reportPoint, style }: LiveMapProps) {
  const points = [...markers, ...(userFix ? [userFix] : []), ...(reportPoint ? [reportPoint] : [])];
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const [minLng, maxLng] = [Math.min(...lngs), Math.max(...lngs)];
  const pos = (p: { latitude: number; longitude: number }) => ({
    left: `${8 + (maxLng > minLng ? (p.longitude - minLng) / (maxLng - minLng) : 0.5) * 84}%` as const,
    top: `${8 + (maxLat > minLat ? (maxLat - p.latitude) / (maxLat - minLat) : 0.5) * 84}%` as const,
  });

  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.notice}>
        <Ionicons name="phone-portrait-outline" size={13} color={colors.textSecondary} />
        <Text style={styles.noticeText}>Live map runs in the mobile app (web preview)</Text>
      </View>
      {markers.map((m) => {
        const look = MARKER_STYLE[m.kind];
        return (
          <Pressable key={m.id} onPress={() => onMarkerPress?.(m.id)} style={[styles.pin, { borderColor: look.color }, pos(m)]}>
            <Ionicons name={look.icon} size={13} color={look.color} />
          </Pressable>
        );
      })}
      {userFix && <View style={[styles.userDot, pos(userFix)]} />}
      {reportPoint && (
        <View style={[styles.reportPin, pos(reportPoint)]}>
          <Ionicons name="location" size={22} color="#D93025" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  reportPin: { position: "absolute", marginLeft: -11, marginTop: -22 },
  wrap: { overflow: "hidden", backgroundColor: "#EAF0EC" },
  notice: {
    position: "absolute",
    left: 8,
    bottom: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.85)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    zIndex: 2,
  },
  noticeText: { fontSize: 10.5, color: colors.textSecondary, fontWeight: "600" },
  pin: {
    position: "absolute",
    width: 26,
    height: 26,
    marginLeft: -13,
    marginTop: -13,
    borderRadius: 13,
    backgroundColor: "#fff",
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  userDot: {
    position: "absolute",
    width: 16,
    height: 16,
    marginLeft: -8,
    marginTop: -8,
    borderRadius: 8,
    backgroundColor: "#3478E5",
    borderWidth: 3,
    borderColor: "#fff",
  },
});
