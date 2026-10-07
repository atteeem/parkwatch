import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { authScreenStyles } from "../../src/components/authScreenStyles";
import { GreenButton } from "../../src/components/GreenButton";
import { AuthField } from "../../src/components/AuthField";
import { useAuth } from "../../src/auth/AuthContext";
import { FormErrors, SignInForm, validateSignIn } from "../../src/auth/authErrors";

// Sign in (backend mode only). Where the user lands afterwards is decided by
// the server-resolved role, not by this screen.
export default function SignIn() {
  const router = useRouter();
  const { signIn, state } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FormErrors<keyof SignInForm>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const notice = state.mode === "BACKEND" && state.status === "unauthenticated" ? state.notice : undefined;

  const submit = async () => {
    if (busy) return;
    const v = validateSignIn({ email, password });
    setErrors(v);
    setFormError(null);
    if (Object.keys(v).length) return;
    setBusy(true);
    const r = await signIn(email, password);
    setBusy(false);
    if (!r.ok) setFormError(r.error.message);
    // On success the auth state changes and the route guard moves on.
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.brand}>ParkWatch</Text>
          <Text style={styles.title}>Sign in</Text>
          <Text style={styles.subtitle}>Report parking problems and follow what happens next.</Text>

          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          {formError ? (
            <View style={styles.errorBanner} accessibilityRole="alert">
              <Text style={styles.errorText}>{formError}</Text>
            </View>
          ) : null}

          <AuthField label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" error={errors.email} />
          <AuthField label="Password" value={password} onChangeText={setPassword} placeholder="Your password" secure autoCapitalize="none" autoComplete="password" textContentType="password" error={errors.password} onSubmitEditing={submit} />

          <GreenButton label={busy ? "Signing in…" : "Sign In"} loading={busy} trailingIcon={null} onPress={submit} style={{ marginTop: 8 }} />

          <View style={styles.switchRow}>
            <Text style={styles.switchText}>New to ParkWatch?</Text>
            <Pressable onPress={() => router.replace("/auth/sign-up")} hitSlop={10} accessibilityRole="link">
              <Text style={styles.link}>Create an account</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = authScreenStyles;
