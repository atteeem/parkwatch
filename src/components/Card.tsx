import React from "react";
import { View, ViewStyle, StyleSheet } from "react-native";
import { colors } from "../constants/colors";
import { radius, shadow } from "../constants/spacing";

type Props = {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  dark?: boolean;
  prominent?: boolean;
  noPadding?: boolean;
};

export function Card({ children, style, dark, prominent, noPadding }: Props) {
  return (
    <View
      style={[
        styles.base,
        noPadding ? undefined : styles.padding,
        dark ? styles.dark : styles.light,
        prominent ? shadow.prominent : shadow.card,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.card,
  },
  padding: {
    padding: 16,
  },
  light: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dark: {
    backgroundColor: colors.cardBlack,
    borderWidth: 0,
  },
});
