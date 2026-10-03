import { TextStyle } from "react-native";
import { colors } from "./colors";

// Approximate hierarchy from the spec (section 5). Keep every screen on
// this scale instead of inventing new font sizes/weights per screen.
export const typography: Record<string, TextStyle> = {
  screenTitle: {
    fontSize: 32,
    fontWeight: "800",
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  screenSubtitle: {
    fontSize: 15,
    fontWeight: "500",
    color: colors.textSecondary,
    marginTop: 4,
  },
  sectionHeading: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  body: {
    fontSize: 15,
    fontWeight: "400",
    color: colors.textPrimary,
  },
  bodyStrong: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  secondary: {
    fontSize: 13.5,
    fontWeight: "500",
    color: colors.textSecondary,
  },
  tiny: {
    fontSize: 11.5,
    fontWeight: "600",
    color: colors.textLight,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
  },
};
