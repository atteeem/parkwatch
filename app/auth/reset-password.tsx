import React, { useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { authScreenStyles } from "../../src/components/authScreenStyles";
import { GreenButton } from "../../src/components/GreenButton";
import { AuthField } from "../../src/components/AuthField";
import { useAuth } from "../../src/auth/AuthContext";
import { FormErrors, NewPasswordForm, parseRecoveryLink, RecoveryLink, validateNewPassword } from "../../src/auth/authErrors";

// Opened from the emailed reset link (parkwatch://auth/reset-password#access_token=…&type=recovery).
// The link's tokens stay in memory only; the new password is set on a separate
// client, so the app itself is NOT signed in by the link - the user signs in
// with the new password afterwards.
export default function ResetPassword() {
  const router = useRouter();
  const { completePasswordReset } = useAuth();
  const incoming = Linking.useURL();
  const [initial, setInitial] = useState<string | null>(null);
  useEffect(() => {
    if (Platform.OS !== "web") void Linking.getInitialURL().then(setInitial, () => setInitial(null));
  }, []);
  // The first valid link seen is kept in memory (the URL may change afterwards).
  const captured = useRef<RecoveryLink>({ kind: "invalid" });
  const webHref = Platform.OS === "web" && typeof window !== "undefined" ? window.location.href : null;
  if (captured.current.kind !== "recovery") {
    for (const candidate of [webHref, incoming, initial]) {
      const parsed = parseRecoveryLink(candidate);
      if (parsed.kind === "recovery") {
        captured.current = parsed;
        break;
      }
    }
  }
  const link = captured.current;
  // Web: don't leave the link's tokens in the address bar or browser history.
  useEffect(() => {
    if (link.kind === "recovery" && Platform.OS === "web" && typeof window !== "undefined" && window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [link.kind]);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirm] = useState("");
  const [errors, setErrors] = useState<FormErrors<keyof NewPasswordForm>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy || link.kind !== "recovery") return;
    const v = validateNewPassword({ password, confirmPassword });
    setErrors(v);
    setFormError(null);
    if (Object.keys(v).length) return;
    setBusy(true);
    const r = await completePasswordReset(link, password);
    setBusy(false);
    if (r.ok) setDone(true);
    else setFormError(r.error.message);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.brand}>ParkWatch</Text>
          <Text style={styles.title}>Set a new password</Text>
          {done ? (
            <>
              <Text style={styles.subtitle} accessibilityRole="alert">Your password has been changed. Sign in with your new password.</Text>
              <GreenButton label="Sign in" trailingIcon={null} onPress={() => router.replace("/auth/sign-in")} style={{ marginTop: 8 }} />
            </>
          ) : link.kind !== "recovery" ? (
            <>
              <Text style={styles.subtitle}>This reset link is not valid anymore. Links work once and expire after a while.</Text>
              <GreenButton label="Request a new link" trailingIcon={null} onPress={() => router.replace("/auth/forgot-password")} style={{ marginTop: 8 }} />
            </>
          ) : (
            <>
              <Text style={styles.subtitle}>Choose a new password for your ParkWatch account.</Text>
              {formError ? (
                <View style={styles.errorBanner} accessibilityRole="alert">
                  <Text style={styles.errorText}>{formError}</Text>
                </View>
              ) : null}
              <AuthField label="New password" value={password} onChangeText={setPassword} placeholder="At least 8 characters" secure autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" error={errors.password} />
              <AuthField label="Repeat new password" value={confirmPassword} onChangeText={setConfirm} placeholder="Repeat the password" secure autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" error={errors.confirmPassword} onSubmitEditing={submit} />
              <GreenButton label={busy ? "Saving…" : "Save new password"} loading={busy} trailingIcon={null} onPress={submit} style={{ marginTop: 8 }} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = authScreenStyles;
