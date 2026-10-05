import { StyleSheet } from "react-native";
import { colors } from "../constants/colors";

/** Shared look for the account screens (sign in, sign up, account status). */
export const authScreenStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingTop: 40 },
  brand: { fontSize: 15, fontWeight: "800", color: colors.greenDark, letterSpacing: 0.5 },
  title: { fontSize: 30, fontWeight: "800", marginTop: 14, color: colors.textPrimary },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginTop: 6, marginBottom: 24 },
  notice: { backgroundColor: colors.blueLight, color: colors.textPrimary, borderRadius: 10, padding: 12, marginBottom: 14, fontSize: 13 },
  errorBanner: { backgroundColor: colors.redLight, borderRadius: 10, padding: 12, marginBottom: 14 },
  errorText: { color: "#B3261E", fontWeight: "600", fontSize: 13 },
  switchRow: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: 22 },
  switchText: { color: colors.textSecondary, fontSize: 13.5 },
  link: { color: colors.greenDark, fontWeight: "800", fontSize: 13.5 },
});
