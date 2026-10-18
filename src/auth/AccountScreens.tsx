// Signed-in account screens (T9.3): change password, close account; (T9.4) username.
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
import { formatChangeDate, normalizeUsername, USERNAME_COOLDOWN_DAYS, usernameChangeStatus, usernameOutcomeMessage, validateUsername } from "./username";

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

export const USERNAME_COPY = {
  title: "Username",
  subtitle: "Your public username on ParkWatch",
  help: `3–24 characters: letters a–z, numbers and underscore. Your username is public: don't use your real name or email. You can change it once every ${USERNAME_COOLDOWN_DAYS} days.`,
  dialogTitle: "Save this username?",
  dialogBody: `After saving, you can't change your username again for ${USERNAME_COOLDOWN_DAYS} days.`,
  demo: "Usernames are not used in the demo.",
  staff: "Usernames are for citizen accounts. Staff accounts use their name.",
};

/** Citizen only (T9.4). Every rule is enforced by the server; this screen explains. */
export function UsernameScreen({ now }: { now?: Date } = {}) {
  const router = useRouter();
  const { setUsername, mode, state } = useAuth();
  const profile = state.mode === "BACKEND" && state.status === "authenticated" ? state.profile : null;
  const isCitizen = state.mode === "BACKEND" && state.status === "authenticated" && state.access?.kind === "CITIZEN";
  const current = profile?.username;
  const cooldown = usernameChangeStatus(profile?.usernameChangedAt, now);
  const [value, setValue] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const review = () => {
    const v = validateUsername(value);
    setFieldError(v);
    setResult(null);
    if (v) return;
    if (normalizeUsername(value) === current) {
      setResult({ ok: true, text: `@${current} is already your username.` });
      return;
    }
    setConfirming(true);
  };

  const save = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const r = await setUsername(normalizeUsername(value));
    inFlight.current = false;
    setBusy(false);
    setConfirming(false);
    if (!r.ok) return setResult({ ok: false, text: r.error.message });
    const ok = r.value.kind === "CHANGED" || r.value.kind === "UNCHANGED";
    setResult({ ok, text: usernameOutcomeMessage(r.value) });
    if (r.value.kind === "CHANGED") setValue("");
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <BackHeader title={USERNAME_COPY.title} subtitle={USERNAME_COPY.subtitle} onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
          {mode !== "BACKEND" ? (
            <Text style={styles.muted}>{USERNAME_COPY.demo}</Text>
          ) : !isCitizen ? (
            <Text style={styles.muted}>{USERNAME_COPY.staff}</Text>
          ) : (
            <View style={{ marginTop: 12 }}>
              <Text style={styles.lead}>{current ? `@${current}` : "No username yet"}</Text>
              {result ? (
                <Text style={result.ok ? styles.success : styles.warning} accessibilityRole="alert">
                  {result.text}
                </Text>
              ) : null}
              {!cooldown.canChange && cooldown.nextChangeAt ? (
                <Text style={styles.note} accessibilityRole="text">
                  You can change it again on {formatChangeDate(cooldown.nextChangeAt)} ({cooldown.daysLeft} {cooldown.daysLeft === 1 ? "day" : "days"}).
                </Text>
              ) : (
                <View style={{ marginTop: 12 }}>
                  <AuthField
                    label={current ? "New username" : "Username"}
                    value={value}
                    onChangeText={(t) => {
                      setValue(t);
                      setFieldError(null);
                    }}
                    placeholder="e.g. helsinki_spotter"
                    autoCapitalize="none"
                    autoComplete="off"
                    maxLength={24}
                    error={fieldError ?? undefined}
                    onSubmitEditing={review}
                  />
                  <Text style={styles.note}>{USERNAME_COPY.help}</Text>
                  <GreenButton label="Save username" trailingIcon={null} onPress={review} style={{ marginTop: 14 }} />
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      <ConfirmDialog
        visible={confirming}
        title={USERNAME_COPY.dialogTitle}
        message={`@${normalizeUsername(value)}

${USERNAME_COPY.dialogBody}`}
        confirmLabel="Save"
        busy={busy}
        onConfirm={() => void save()}
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
