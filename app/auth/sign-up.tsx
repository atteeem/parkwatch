import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { GreenButton } from "../../src/components/GreenButton";
import { AuthField } from "../../src/components/AuthField";
import { authScreenStyles as styles } from "../../src/components/authScreenStyles";
import { useAuth } from "../../src/auth/AuthContext";
import { FormErrors, MIN_PASSWORD_LENGTH, SignUpForm, validateSignUp } from "../../src/auth/authErrors";

// Create a CITIZEN account. There is deliberately no role choice: officer,
// supervisor and admin accounts are provisioned by the server/admins only.
export default function SignUp() {
  const router = useRouter();
  const { signUp } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<FormErrors<keyof SignUpForm>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmEmailFor, setConfirmEmailFor] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    const v = validateSignUp({ displayName, email, password, confirmPassword });
    setErrors(v);
    setFormError(null);
    if (Object.keys(v).length) return;
    setBusy(true);
    const r = await signUp(displayName, email, password);
    setBusy(false);
    if (!r.ok) {
      setFormError(r.error.message);
      return;
    }
    if (r.value.kind === "CONFIRM_EMAIL") {
      // No session yet: the user is NOT signed in until they confirm.
      setPassword("");
      setConfirmPassword("");
      setConfirmEmailFor(r.value.email);
    }
    // SIGNED_IN: the auth state changes and the route guard opens the citizen app.
  };

  if (confirmEmailFor) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.content}>
          <Ionicons name="mail-unread-outline" size={40} color={colors.greenDark} />
          <Text style={styles.title}>Check your email</Text>
          <Text style={styles.subtitle}>
            If {confirmEmailFor} can be used for a new account, we've sent it a confirmation link. Open the link, then sign in.
          </Text>
          <GreenButton label="Back to Sign In" trailingIcon={null} onPress={() => router.replace("/auth/sign-in")} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.brand}>ParkWatch</Text>
          <Text style={styles.title}>Create account</Text>
          <Text style={styles.subtitle}>A citizen account lets you report parking problems and receive rewards for verified reports.</Text>

          {formError ? (
            <View style={styles.errorBanner} accessibilityRole="alert">
              <Text style={styles.errorText}>{formError}</Text>
            </View>
          ) : null}

          <AuthField label="Name" value={displayName} onChangeText={setDisplayName} placeholder="Your name" autoCapitalize="words" autoComplete="name" textContentType="name" maxLength={80} error={errors.displayName} />
          <AuthField label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" error={errors.email} />
          <AuthField label="Password" value={password} onChangeText={setPassword} placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`} secure autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" error={errors.password} />
          <AuthField label="Confirm password" value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Repeat your password" secure autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" error={errors.confirmPassword} onSubmitEditing={submit} />

          <GreenButton label={busy ? "Creating account…" : "Create Account"} loading={busy} trailingIcon={null} onPress={submit} style={{ marginTop: 8 }} />

          <View style={styles.switchRow}>
            <Text style={styles.switchText}>Already have an account?</Text>
            <Pressable onPress={() => router.replace("/auth/sign-in")} hitSlop={10} accessibilityRole="link">
              <Text style={styles.link}>Sign in</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
