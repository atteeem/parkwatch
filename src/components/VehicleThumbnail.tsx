import React from "react";
import { View, Image, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../constants/colors";

type Props = {
  uri?: string;
  size?: number;
  radius?: number;
};

export function VehicleThumbnail({ uri, size = 52, radius = 12 }: Props) {
  return (
    <View style={[styles.wrap, { width: size, height: size, borderRadius: radius }]}>
      {uri ? (
        <Image source={{ uri }} style={{ width: size, height: size, borderRadius: radius }} />
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
