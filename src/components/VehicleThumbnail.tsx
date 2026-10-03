import React from "react";
import { View, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../constants/colors";
import { EvidencePhoto } from "./EvidencePhoto";

type Props = {
  uri?: string;
  size?: number;
  radius?: number;
};

export function VehicleThumbnail({ uri, size = 52, radius = 12 }: Props) {
  return (
    <View style={[styles.wrap, { width: size, height: size, borderRadius: radius }]}>
      {uri ? (
        <EvidencePhoto uri={uri} style={{ width: size, height: size, borderRadius: radius }} compact />
      ) : (
        <Ionicons name="car" size={size * 0.42} color={colors.textLight} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.backgroundSunk,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
});
