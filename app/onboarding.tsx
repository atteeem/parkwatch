import React, { useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../src/constants/colors";
import { radius } from "../src/constants/spacing";
import { GreenButton } from "../src/components/GreenButton";
import { useReducedMotion } from "../src/hooks/useReducedMotion";
import { ONBOARDING_PAGES, OnboardingPage } from "../src/onboarding/onboarding";
import { onboardingPreference } from "../src/onboarding/OnboardingPreference";
import { indexFromOffset } from "../src/presentation/evidenceGallery";

// First-run onboarding (T8.8). Explains ParkWatch before any permission is
// asked; it requests none itself. ?mode=review reopens it from the Profile
// (finishing just goes back). The "seen it" flag is a device preference.
export default function Onboarding() {
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const review = mode === "review";
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const listRef = useRef<FlatList<OnboardingPage>>(null);
  const [page, setPage] = useState(0);
  const last = page === ONBOARDING_PAGES.length - 1;

  const goTo = (i: number) => {
    setPage(i);
    listRef.current?.scrollToIndex({ index: i, animated: !reduceMotion });
  };

  const finish = () => {
    if (review) {
      if (router.canGoBack()) router.back();
      else router.replace("/");
      return;
    }
    void onboardingPreference.complete();
    router.replace("/");
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.topRow}>
        <Text style={styles.brand}>ParkWatch</Text>
        {!last ? (
          <Pressable onPress={finish} hitSlop={12} accessibilityRole="button" accessibilityLabel={review ? "Close introduction" : "Skip introduction"} style={styles.skip}>
            <Text style={styles.skipLabel}>{review ? "Close" : "Skip"}</Text>
          </Pressable>
        ) : (
          <View style={styles.skip} />
        )}
      </View>

      <FlatList
        ref={listRef}
        data={ONBOARDING_PAGES as OnboardingPage[]}
        keyExtractor={(p) => p.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onMomentumScrollEnd={(e) => setPage(indexFromOffset(e.nativeEvent.contentOffset.x, width, ONBOARDING_PAGES.length))}
        renderItem={({ item, index }) => (
          <View
            style={[styles.page, { width }]}
            accessible
            accessibilityLabel={`Step ${index + 1} of ${ONBOARDING_PAGES.length}. ${item.title}. ${item.points.join(" ")}`}
          >
            <View style={styles.iconCircle}>
              <Ionicons name={item.icon} size={44} color={colors.greenDark} />
            </View>
            <Text style={styles.title}>{item.title}</Text>
            <View style={styles.points}>
              {item.points.map((p) => (
                <View key={p} style={styles.pointRow}>
                  <Ionicons name="checkmark-circle" size={18} color={colors.greenDark} style={{ marginTop: 1 }} />
                  <Text style={styles.pointText}>{p}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      />

      <View style={styles.footer}>
        <View style={styles.dots} accessibilityRole="progressbar" accessibilityLabel={`Step ${page + 1} of ${ONBOARDING_PAGES.length}`}>
          {ONBOARDING_PAGES.map((p, i) => (
            <View key={p.key} style={[styles.dot, i === page && styles.dotActive]} />
          ))}
        </View>
        {last ? (
          <GreenButton label={review ? "Done" : "Get Started"} onPress={finish} trailingIcon={null} />
        ) : (
          <GreenButton label="Next" onPress={() => goTo(page + 1)} />
        )}
        {last && !review ? (
          <Pressable onPress={() => goTo(0)} accessibilityRole="button" style={styles.secondary} hitSlop={8}>
            <Text style={styles.secondaryLabel}>View how it works again</Text>
          </Pressable>
        ) : page > 0 ? (
          <Pressable onPress={() => goTo(page - 1)} accessibilityRole="button" accessibilityLabel="Previous step" style={styles.secondary} hitSlop={8}>
            <Text style={styles.secondaryLabel}>Back</Text>
          </Pressable>
        ) : (
          <View style={styles.secondary} />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 8 },
  brand: { fontSize: 18, fontWeight: "800", color: colors.greenDark },
  skip: { minWidth: 44, minHeight: 44, alignItems: "flex-end", justifyContent: "center" },
  skipLabel: { fontSize: 15, fontWeight: "700", color: colors.textSecondary },
  page: { flex: 1, paddingHorizontal: 28, justifyContent: "center" },
  iconCircle: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.greenLight, alignItems: "center", justifyContent: "center", marginBottom: 28 },
  title: { fontSize: 28, fontWeight: "800", color: colors.textPrimary, letterSpacing: -0.4 },
  points: { marginTop: 18, gap: 12 },
  pointRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  pointText: { flex: 1, fontSize: 16, lineHeight: 22, color: colors.textPrimary },
  footer: { paddingHorizontal: 20, paddingBottom: 12, gap: 14 },
  dots: { flexDirection: "row", justifyContent: "center", gap: 8, paddingVertical: 4 },
  dot: { width: 8, height: 8, borderRadius: radius.chip, backgroundColor: colors.borderLight },
  dotActive: { width: 22, backgroundColor: colors.greenDark },
  secondary: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  secondaryLabel: { fontSize: 14.5, fontWeight: "700", color: colors.greenDark },
});
