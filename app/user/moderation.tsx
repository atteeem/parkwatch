import React from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors } from "../../src/constants/colors";
import { BackHeader } from "../../src/components/Header";
import { useApp } from "../../src/context/AppContext";
import { RestrictionNotice, useMyModeration } from "../../src/moderation/citizenModeration";
import { MAX_STRIKES, strikeText } from "../../src/moderation/moderationTypes";

// Reporting status (T9.5): the citizen's own moderation state. No staff notes
// or staff identities ever reach this screen.
export default function ReportingStatus() {
  const router = useRouter();
  const { moderation } = useApp();
  const m = useMyModeration(moderation);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <BackHeader title="Reporting status" subtitle="Your access to submit reports" onBack={() => (router.canGoBack() ? router.back() : router.replace("/user/profile"))} />
        {!moderation ? (
          <Text style={styles.muted}>Reporting status is not used in the demo.</Text>
        ) : m.phase === "loading" && !m.data ? (
          <ActivityIndicator style={{ marginTop: 24 }} />
        ) : m.phase === "failed" || !m.data ? (
          <>
            <Text style={styles.muted}>Couldn't load your reporting status.</Text>
            <Pressable onPress={() => void m.reload()} accessibilityRole="button">
              <Text style={styles.link}>Try again</Text>
            </Pressable>
          </>
        ) : m.data.status === "ACTIVE" ? (
          <>
            <Text style={styles.ok}>You can submit reports.</Text>
            {m.data.strikes > 0 ? (
              <Text style={styles.muted}>
                Earlier restrictions on this account: {strikeText(m.data.strikes, m.data.maxStrikes)}. After {MAX_STRIKES} restrictions, reporting access is restricted indefinitely.
              </Text>
            ) : null}
          </>
        ) : (
          <RestrictionNotice m={m.data} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 40, gap: 12 },
  ok: { fontSize: 16, fontWeight: "800", color: colors.greenDark, marginTop: 12 },
  muted: { fontSize: 14, color: colors.textSecondary, marginTop: 8, lineHeight: 20 },
  link: { color: colors.greenDark, fontWeight: "700", marginTop: 10 },
});
