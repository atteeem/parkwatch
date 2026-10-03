import React from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../constants/colors";
import { radius } from "../../constants/spacing";
import { LocationPermission } from "../../location/locationState";

/** Recenter / follow-me button. Filled while following. */
export function FollowLocationButton({
  following,
  disabled,
  onPress,
}: {
  following: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.btn, following && styles.btnActive, disabled && { opacity: 0.4 }]}
      accessibilityLabel={following ? "Following your location" : "Center on my location"}
      hitSlop={6}
    >
      <Ionicons name={following ? "navigate" : "locate"} size={18} color={following ? "#fff" : colors.textPrimary} />
    </Pressable>
  );
}

/**
 * Location permission/availability notice for map screens. The map keeps
 * working (markers visible) whatever the state; only the user dot and
 * follow mode need permission.
 */
export function LocationNotice({
  permission,
  error,
  onRequest,
  onRetry,
}: {
  permission: LocationPermission;
  error?: string;
  onRequest: () => void;
  onRetry: () => void;
}) {
  if (permission === "granted" && !error) return null;
  const native = Platform.OS !== "web";
  let message: string;
  let action: { label: string; onPress: () => void } | null;
  if (permission === "undetermined") {
    message = "Share your location to see where you are on the map.";
    action = { label: "Allow location", onPress: onRequest };
  } else if (permission === "denied") {
    message = "Location is off, so your position isn't shown. Report markers still work.";
    action = { label: "Try again", onPress: onRequest };
  } else if (permission === "blocked") {
    message = native
      ? "Location access is turned off for ParkWatch. Enable it in Settings to see your position."
      : "Location is blocked for this site. Allow it in your browser's site settings.";
    action = native ? { label: "Open settings", onPress: () => void Linking.openSettings() } : null;
  } else {
    message = error ?? "Your current location is not available right now.";
    action = { label: "Retry", onPress: onRetry };
  }
  return (
    <View style={styles.notice}>
      <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
      <Text style={styles.noticeText}>{message}</Text>
      {action && (
        <Pressable onPress={action.onPress} hitSlop={6}>
          <Text style={styles.noticeAction}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  btnActive: { backgroundColor: "#3478E5" },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fff",
    borderRadius: radius.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  noticeText: { flex: 1, fontSize: 12, color: colors.textSecondary },
  noticeAction: { fontSize: 12.5, fontWeight: "800", color: colors.greenDark },
});
