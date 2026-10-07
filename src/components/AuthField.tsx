import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, TextInputProps } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../constants/colors";
import { radius } from "../constants/spacing";

/** Labelled text field for the account screens; `secure` adds a show/hide toggle. */
export function AuthField({
  label,
  error,
  secure,
  ...input
}: { label: string; error?: string; secure?: boolean } & Omit<TextInputProps, "secureTextEntry" | "style">) {
  const [hidden, setHidden] = useState(true);
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.box, error ? styles.boxError : null]}>
        <TextInput
          style={styles.input}
          placeholderTextColor={colors.textLight}
          secureTextEntry={secure ? hidden : false}
          autoCorrect={false}
          accessibilityLabel={label}
          {...input}
        />
        {secure && (
          <Pressable onPress={() => setHidden((h) => !h)} hitSlop={10} accessibilityRole="button" accessibilityLabel={hidden ? "Show password" : "Hide password"}>
            <Ionicons name={hidden ? "eye-outline" : "eye-off-outline"} size={20} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontWeight: "800", fontSize: 13.5, marginBottom: 8, color: colors.textPrimary },
  box: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, paddingHorizontal: 14, backgroundColor: colors.white },
  boxError: { borderColor: colors.red },
  input: { flex: 1, paddingVertical: 12, fontSize: 15, color: colors.textPrimary },
  error: { color: "#B3261E", fontSize: 12.5, fontWeight: "600", marginTop: 6 },
});
