// Centralized design tokens. Every screen should pull colors from here
// rather than hard-coding hex values, so the app reads as one product.

export const colors = {
  background: "#FFFFFF",
  backgroundSunk: "#F6F7F6",

  green: "#5CF58A",
  greenDark: "#18B83E",
  greenLight: "#CFFFD9",

  black: "#000000",
  cardBlack: "#0D0F0D",

  textPrimary: "#000000",
  textSecondary: "#7E7E82",
  textLight: "#A5A5A8",

  border: "#D7D7DA",
  borderLight: "#E9E9EB",

  red: "#FF3B30",
  redLight: "#FFD0D3",

  amber: "#FFB51A",
  amberLight: "#FFF1CE",

  blue: "#3478E5",
  blueLight: "#DCE8FC",

  purple: "#AE24E8",
  purpleLight: "#F1DDFB",

  white: "#FFFFFF",
} as const;

export type ColorToken = keyof typeof colors;
