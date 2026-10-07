import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../constants/colors";
import { typography } from "../constants/typography";
import { radius } from "../constants/spacing";
import { Card } from "./Card";
import { FadeIn } from "./motion/FadeIn";
import type { InfoPage } from "../content/infoPages";

/** Read-only informational page (Help, About, Privacy & Data, draft legal pages). */
export function InfoPageView({ page, fallbackHref }: { page: InfoPage; fallbackHref: "/user/profile" | "/officer/profile" }) {
  const router = useRouter();
  const back = () => (router.canGoBack() ? router.back() : router.replace(fallbackHref));

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Ionicons name="chevron-back" size={22} color={colors.textPrimary} onPress={back} accessibilityRole="button" accessibilityLabel="Back" style={{ marginBottom: 4 }} />
        <Text style={typography.screenTitle} accessibilityRole="header">
          {page.title}
        </Text>
        <Text style={typography.screenSubtitle}>{page.subtitle}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <FadeIn>
          {page.notice ? (
            <View style={styles.notice} accessible accessibilityLabel={`${page.notice.label}. ${page.notice.text}`}>
              <View style={styles.noticeBadge}>
                <Ionicons name="document-text-outline" size={13} color={colors.textPrimary} />
                <Text style={styles.noticeLabel}>{page.notice.label}</Text>
              </View>
              <Text style={styles.noticeText}>{page.notice.text}</Text>
            </View>
          ) : null}
          {page.sections.map((s) => (
            <Card key={s.heading} style={{ marginBottom: 12 }}>
              <Text style={styles.heading} accessibilityRole="header">
                {s.heading}
              </Text>
              {s.paragraphs?.map((p) => (
                <Text key={p} style={styles.paragraph}>
                  {p}
                </Text>
              ))}
              {s.bullets?.map((b) => (
                <View key={b} style={styles.bulletRow}>
                  <View style={styles.bulletDot} />
                  <Text style={[styles.paragraph, { flex: 1, marginTop: 0 }]}>{b}</Text>
                </View>
              ))}
            </Card>
          ))}
        </FadeIn>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: 20, paddingTop: 4 },
  notice: { backgroundColor: colors.backgroundSunk, borderRadius: radius.card, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.borderLight },
  noticeBadge: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", backgroundColor: colors.white, borderRadius: radius.chip, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 8 },
  noticeLabel: { fontSize: 11, fontWeight: "800", color: colors.textPrimary },
  noticeText: { fontSize: 13, lineHeight: 19, color: colors.textPrimary },
  heading: { fontSize: 15, fontWeight: "800", color: colors.textPrimary, marginBottom: 2 },
  paragraph: { fontSize: 13.5, lineHeight: 20, color: colors.textSecondary, marginTop: 6 },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", marginTop: 8 },
  bulletDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.greenDark, marginTop: 8, marginRight: 10 },
});
