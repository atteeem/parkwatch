// Signed-in account screens (T9.3): change password, close account.
// Server-backed only; the local demo explains that they are not available there.

import React, { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors } from "../constants/colors";
import { radius } from "../constants/spacing";
import { BackHeader } from "../components/Header";
import { AuthField } from "../components/AuthField";
import { GreenButton } from "../components/GreenButton";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { authScreenStyles } from "../components/authScreenStyles";
import { ACCOUNT_DELETION_COPY as COPY } from "../content/accountDeletion";
import { useAuth } from "./AuthContext";
import { FormErrors, NewPasswordForm, validateNewPassword } from "./authErrors";

export function ChangePasswordScreen() {
  const router = useRouter();
  const { changePassword, mode } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirm] = useState("");
  const [errors, setErrors] = useState<FormErrors<keyof NewPasswordForm>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    const v = validateNewPassword({ password, confirmPassword });
    setErrors(v);
    setFormError(null);
    if (Object.keys(v).length) return;
    setBusy(true);
    const r = await changePassword(password);
    setBusy(false);
    if (r.ok) {
      setDone(true);
      setPassword("");
      setConfirm("");
    } else setFormError(r.error.message);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <BackHeader title="Password" subtitle="Change the password you sign in with" onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
          {mode !== "BACKEND" ? (
            <Text style={styles.muted}>Passwords are not used in the demo.</Text>
          ) : done ? (
            <Text style={styles.success} accessibilityRole="alert">
              Your password has been changed.
            </Text>
          ) : (
            <View style={{ marginTop: 12 }}>
              {formError ? (
                <View style={authScreenStyles.errorBanner} accessibilityRole="alert">
                  <Text style={authScreenStyles.errorText}>{formError}</Text>
                </View>
              ) : null}
              <AuthField label="New password" value={password} onChangeText={setPassword} placeholder="At least 8 characters" secure autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" error={errors.password} />
              <AuthField label="Repeat new password" value={confirmPassword} onChangeText={setConfirm} placeholder="Repeat the password" secure autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" error={errors.confirmPassword} onSubmitEditing={submit} />
              <GreenButton label={busy ? "Saving…" : "Save new password"} loading={busy} trailingIcon={null} onPress={submit} style={{ marginTop: 8 }} />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Citizen only (officer/staff accounts are closed by their organization). */
export function CloseAccountScreen({ rewardBalanceEuros }: { rewardBalanceEuros: string | null }) {
  const router = useRouter();
  const { closeAccount, mode, state } = useAuth();
  const [typed, setTyped] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const isCitizen = state.mode === "BACKEND" && state.status === "authenticated" && state.access?.kind === "CITIZEN";
  const ready = typed.trim().toUpperCase() === COPY.confirmWord;

  const run = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const r = await closeAccount();
    inFlight.current = false;
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    // On success the account is signed out and the route guard leaves this screen.
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <BackHeader title={COPY.title} onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
        {mode !== "BACKEND" ? (
          <Text style={styles.muted}>{COPY.demoNote}</Text>
        ) : !isCitizen ? (
          <Text style={styles.muted}>{COPY.staffNote}</Text>
        ) : (
          <>
            <Text style={styles.lead}>{COPY.intro}</Text>
            <Text style={styles.heading}>{COPY.removedHeading}</Text>
            {COPY.removed.map((t) => (
              <Text key={t} style={styles.bullet}>• {t}</Text>
            ))}
            <Text style={styles.note}>{COPY.afterwards}</Text>
            <Text style={styles.heading}>{COPY.keptHeading}</Text>
            {COPY.kept.map((t) => (
              <Text key={t} style={styles.bullet}>• {t}</Text>
            ))}
            {rewardBalanceEuros ? <Text style={styles.warning}>{COPY.rewardWarning(rewardBalanceEuros)}</Text> : null}
            <Text style={styles.label}>{COPY.confirmLabel}</Text>
            <TextInput
              value={typed}
              onChangeText={setTyped}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder={COPY.confirmWord}
              style={styles.input}
              accessibilityLabel={COPY.confirmLabel}
            />
            {error ? (
              <View style={authScreenStyles.errorBanner} accessibilityRole="alert">
                <Text style={authScreenStyles.errorText}>{error}</Text>
              </View>
            ) : null}
            <GreenButton label={COPY.action} variant="destructive" trailingIcon={null} disabled={!ready || busy} loading={busy} onPress={() => setConfirming(true)} style={{ marginTop: 12 }} />
          </>
        )}
      </ScrollView>
      <ConfirmDialog
        visible={confirming}
        title={COPY.dialogTitle}
        message={COPY.dialogBody}
        confirmLabel={COPY.action}
        destructive
        busy={busy}
        error={error}
        onConfirm={() => void run()}
        onCancel={() => setConfirming(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 40 },
  muted: { marginTop: 16, fontSize: 15, color: colors.textSecondary },
  success: { marginTop: 16, fontSize: 15, fontWeight: "700", color: colors.greenDark },
  lead: { marginTop: 16, fontSize: 16, fontWeight: "800", color: colors.textPrimary },
  heading: { marginTop: 16, marginBottom: 4, fontSize: 13, fontWeight: "800", color: colors.textSecondary, textTransform: "uppercase", letterSpacing: 0.4 },
  note: { marginTop: 6, fontSize: 13.5, lineHeight: 19, color: colors.textSecondary },
  bullet: { fontSize: 14.5, lineHeight: 21, color: colors.textPrimary },
  warning: { marginTop: 14, padding: 12, borderRadius: radius.card, backgroundColor: colors.amberLight, color: "#6B4500", fontSize: 14, fontWeight: "600" },
  label: { marginTop: 18, marginBottom: 6, fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: colors.textPrimary },
});
