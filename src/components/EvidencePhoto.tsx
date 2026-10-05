import React, { useState } from "react";
import { View, Image, Text, StyleSheet, StyleProp, ImageStyle, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../constants/colors";
import { demoPhotoSlot, isDemoPhotoUri, isLegacyPlaceholderUri } from "../data/demoPhotos";
import { isStorageReference } from "../data/storageUri";

const SLOT_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  LICENSE_PLATE: "pricetag-outline",
  PARKING_SIGN: "flag-outline",
  VIOLATION_CONTEXT: "map-outline",
};

/**
 * An evidence photo. Real captures render as the image; seeded demo evidence
 * (and any legacy placeholder URL) renders as a neutral local tile, so the
 * app never downloads random images or passes a placeholder off as evidence.
 */
export function EvidencePhoto({
  uri,
  style,
  compact,
}: {
  uri?: string;
  style?: StyleProp<ImageStyle & ViewStyle>;
  /** Small thumbnails: icon only, no caption. */
  compact?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  // Server evidence that could not be signed (no access, offline) or failed to load:
  // say so instead of showing a broken image. Never fetched through a public URL.
  if (uri && (isStorageReference(uri) || failed === uri)) {
    return (
      <View style={[styles.tile, style as StyleProp<ViewStyle>]} accessibilityLabel="Photo unavailable">
        <Ionicons name="image-outline" size={compact ? 18 : 30} color={colors.textLight} />
        {!compact && <Text style={styles.caption}>Photo unavailable</Text>}
      </View>
    );
  }
  if (uri && !isDemoPhotoUri(uri) && !isLegacyPlaceholderUri(uri)) {
    return <Image source={{ uri }} style={style as StyleProp<ImageStyle>} onError={() => setFailed(uri)} />;
  }
  const slot = uri ? demoPhotoSlot(uri) : undefined;
  return (
    <View style={[styles.tile, style as StyleProp<ViewStyle>]} accessibilityLabel="Demo photo">
      <Ionicons name={(slot && SLOT_ICON[slot]) || "car-outline"} size={compact ? 18 : 30} color={colors.textLight} />
      {!compact && <Text style={styles.caption}>Demo photo</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { backgroundColor: "#E8EEEA", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  caption: { marginTop: 4, fontSize: 10.5, fontWeight: "600", color: colors.textLight },
});
