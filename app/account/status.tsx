import React, { useState } from "react";
import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { GreenButton } from "../../src/components/GreenButton";
import { ConfirmDialog } from "../../src/components/ConfirmDialog";
import { authScreenStyles as styles } from "../../src/components/authScreenStyles";
import { useAuth } from "../../src/auth/AuthContext";
import { accountStatusCopy } from "../../src/auth/accountStatus";

// Signed in, but not routed to an app: staff account without app tools yet,
// officer account without active authorization, or the profile couldn't be
// loaded. Truthful message + retry + sign out; never a fallback role.
export default function AccountStatus() {
  const { state, refreshProfile, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const copy = accountStatusCopy(state);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.content}>
        <Ionicons name={copy.icon} size={40} color={colors.greenDark} />
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.subtitle}>{copy.body}</Text>
        {copy.canRetry && (
          <GreenButton
            label={busy ? "Checking…" : "Check again"}
            loading={busy}
            trailingIcon={null}
            onPress={async () => {
              setBusy(true);
              await refreshProfile();
              setBusy(false);
            }}
          />
        )}
        <GreenButton label="Sign Out" variant="outline" trailingIcon={null} style={{ marginTop: 12 }} onPress={() => setConfirmOut(true)} />
      </View>
      <ConfirmDialog
        visible={confirmOut}
        title="Sign out?"
        message="You'll need to sign in again to use ParkWatch."
        confirmLabel="Sign Out"
        onCancel={() => setConfirmOut(false)}
        onConfirm={() => {
          setConfirmOut(false);
          void signOut();
        }}
      />
    </SafeAreaView>
  );
}
