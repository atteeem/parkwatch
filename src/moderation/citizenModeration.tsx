// Citizen side of reporting moderation (T9.5): the own status (no notes, no
// staff identities) and the restriction notice. The server refuses restricted
// reports regardless; this only explains it before the camera opens.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../constants/colors";
import { radius } from "../constants/spacing";
import type { CitizenModeration, ModerationApi } from "./moderationTypes";
import { citizenRestrictionCopy } from "./moderationTypes";

export type MyModerationState = { phase: "idle" | "loading" | "ready" | "failed"; data: CitizenModeration | null; reload: () => Promise<void> };

/** Own status; "idle" without a server (local demo). A failed load never blocks reporting: the server decides. */
export function useMyModeration(api: ModerationApi | null): MyModerationState {
  const [phase, setPhase] = useState<MyModerationState["phase"]>(api ? "loading" : "idle");
  const [data, setData] = useState<CitizenModeration | null>(null);
  const mounted = useRef(true);
  const reload = useCallback(async () => {
    if (!api) return;
    setPhase("loading");
    const r = await api.getMine();
    if (!mounted.current) return;
    if (r.ok) {
      setData(r.value);
      setPhase("ready");
    } else setPhase("failed");
  }, [api]);
  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
    };
  }, [reload]);
  return { phase, data, reload };
}

export function RestrictionNotice({ m }: { m: CitizenModeration }) {
  const copy = citizenRestrictionCopy(m);
  if (!copy) return null;
  const indefinite = m.status === "INDEFINITELY_RESTRICTED";
  return (
    <View style={[styles.box, indefinite ? styles.boxRed : styles.boxAmber]} accessibilityRole="summary">
      <View style={styles.titleRow}>
        <Ionicons name={indefinite ? "lock-closed" : "time-outline"} size={18} color={colors.textPrimary} />
        <Text style={styles.title} accessibilityRole="header">
          {copy.title}
        </Text>
      </View>
      {copy.lines.map((l) => (
        <Text key={l} style={styles.line}>
          {l}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.card, padding: 16, borderWidth: 1 },
  boxAmber: { backgroundColor: colors.amberLight, borderColor: colors.amber },
  boxRed: { backgroundColor: colors.redLight, borderColor: colors.red },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 16, fontWeight: "800", color: colors.textPrimary, flex: 1 },
  line: { fontSize: 14, color: colors.textPrimary, marginTop: 8, lineHeight: 20 },
});
