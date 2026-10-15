import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { authScreenStyles } from "../../src/components/authScreenStyles";
import { GreenButton } from "../../src/components/GreenButton";
import { AuthField } from "../../src/components/AuthField";
import { useAuth } from "../../src/auth/AuthContext";
import { EmailForm, FormErrors, validateEmailOnly } from "../../src/auth/authErrors";
import { passwordResetRedirect } from "../../src/auth/passwordResetRedirect";

/** Same wording whether or not the email has an account (no account probing). */
const RESET_SENT_COPY = "If an account exists for this email, we've sent a link to set a new password. Open it on this phone.";

// Forgot password (signed out, backend mode). Emails a reset link that opens
// /auth/reset-password in this app (explicit redirect per app variant, see
// passwordResetRedirect - never the Supabase Site URL fallback).
export default function ForgotPassword() {
  const router = useRouter();
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<FormErrors<keyof EmailForm>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    const v = validateEmailOnly({ email });
    setErrors(v);
    setFormError(null);
    if (Object.keys(v).length) return;
    setBusy(true);
    const r = await requestPasswordReset(
      email,
      passwordResetRedirect({
        platform: Platform.OS,
        appVariant: (Constants.expoConfig?.extra as { appVariant?: unknown } | undefined)?.appVariant,
        webOrigin: Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : undefined,
      })
    );
    setBusy(false);
    if (r.ok) setSent(true);
    else setFormError(r.error.message);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.brand}>ParkWatch</Text>
          <Text style={styles.title}>Reset password</Text>
          {sent ? (
            <>
              <Text style={styles.subtitle} accessibilityRole="alert">{RESET_SENT_COPY}</Text>
              <GreenButton label="Back to sign in" trailingIcon={null} onPress={() => router.replace("/auth/sign-in")} style={{ marginTop: 8 }} />
            </>
          ) : (
            <>
              <Text style={styles.subtitle}>Enter the email you signed up with. We'll send you a link to set a new password.</Text>
              {formError ? (
                <View style={styles.errorBanner} accessibilityRole="alert">
                  <Text style={styles.errorText}>{formError}</Text>
                </View>
              ) : null}
              <AuthField label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" error={errors.email} onSubmitEditing={submit} />
              <GreenButton label={busy ? "Sending…" : "Send reset link"} loading={busy} trailingIcon={null} onPress={submit} style={{ marginTop: 8 }} />
              <View style={styles.switchRow}>
                <Pressable onPress={() => router.replace("/auth/sign-in")} hitSlop={10} accessibilityRole="link">
                  <Text style={styles.link}>Back to sign in</Text>
                </Pressable>
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = authScreenStyles;
