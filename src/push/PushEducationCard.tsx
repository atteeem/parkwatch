// Inline permission education for push (shown where it is useful: after a
// citizen's report is sent, on the officer's home, and in Notifications).
// The OS prompt appears only after "Turn on notifications" is tapped.

import React, { useState } from "react";
import { StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../constants/colors";
import { radius } from "../constants/spacing";
import { GreenButton } from "../components/GreenButton";
import { usePushNotifications } from "./PushNotificationsContext";
import { PUSH_COPY } from "./pushRegistration";

export function PushEducationCard({ audience, style }: { audience: "citizen" | "officer"; style?: StyleProp<ViewStyle> }) {
  const push = usePushNotifications();
  const [busy, setBusy] = useState(false);
  if (!push.educationVisible) return null;
  const title = audience === "citizen" ? PUSH_COPY.citizenTitle : PUSH_COPY.officerTitle;
  const body = audience === "citizen" ? PUSH_COPY.citizenBody : PUSH_COPY.officerBody;
  return (
    <View style={[styles.card, style]} accessibilityRole="summary" testID="push-education">
      <View style={styles.head}>
        <View style={styles.icon}>
          <Ionicons name="notifications" size={18} color={colors.greenDark} />
        </View>
        <Text style={styles.title}>{title}</Text>
      </View>
      <Text style={styles.body}>{body}</Text>
      <View style={styles.actions}>
        <GreenButton
          label={PUSH_COPY.enable}
          small
          trailingIcon={null}
          loading={busy}
          style={styles.primary}
          onPress={async () => {
            setBusy(true);
            try {
              await push.enable();
            } finally {
              setBusy(false);
            }
          }}
        />
        <GreenButton label={PUSH_COPY.notNow} small variant="gray" trailingIcon={null} onPress={push.dismissEducation} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.card, borderWidth: 1, borderColor: colors.borderLight, backgroundColor: colors.background, padding: 14, gap: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  icon: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.greenLight, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 15, fontWeight: "800", color: colors.textPrimary },
  body: { fontSize: 13, lineHeight: 18, color: colors.textSecondary },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  primary: { flexGrow: 1 },
});
