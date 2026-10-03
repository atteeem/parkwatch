import React, { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { CameraCapture, CaptureSlot } from "../../src/components/CameraCapture";
import { BackHeader } from "../../src/components/Header";
import { colors } from "../../src/constants/colors";
import { useApp } from "../../src/context/AppContext";
import { describeDomainError } from "../../src/presentation/errors";
import { OFFICER_PHOTO_KEY_TO_TYPE, OfficerPhotoKey } from "../../src/presentation/viewModels";

const SLOT_LABEL: Record<OfficerPhotoKey, string> = {
  overview: "Vehicle overview",
  plate: "License plate",
  sign: "Parking sign",
  context: "Violation context",
};

const isPhotoKey = (k: string | undefined): k is OfficerPhotoKey => !!k && k in OFFICER_PHOTO_KEY_TO_TYPE;

// OFF-07. Captures exactly one officer photo into the requested slot of THIS
// case's inspection (source CAMERA), then pops back to the same inspection.
// A failed capture or save stays here and stores nothing.
export default function OfficerViolationPhoto() {
  const router = useRouter();
  const { id, target } = useLocalSearchParams<{ id: string; target: string }>();
  const { getCase, getInspection, setOfficerPhoto } = useApp();
  const [saveError, setSaveError] = useState<string | null>(null);
  const c = getCase(id);
  const inspection = c ? getInspection(c.id) : undefined;
  const goBack = () =>
    router.canGoBack() ? router.back() : router.replace({ pathname: "/officer/inspection", params: { id } });

  if (!c || !inspection?.exists || !isPhotoKey(target)) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <BackHeader title="Capture Photo" onBack={goBack} />
        <Text style={styles.stateText}>
          {!c ? "This case could not be found." : !isPhotoKey(target) ? "Unknown photo type." : "The inspection for this case has not started."}
        </Text>
      </SafeAreaView>
    );
  }

  const label = SLOT_LABEL[target];
  const slots: CaptureSlot[] = [{ key: target, label, done: !!inspection.officerPhotos[target] }];

  return (
    <View style={{ flex: 1 }}>
      <CameraCapture
        headerTitle={label}
        instructionTitle="Capture Evidence"
        instructionBody={saveError ?? `Take a clear photo for: ${label}.`}
        slots={slots}
        activeSlotKey={target}
        onCapturePhoto={(_slotKey, uri, capturedAt) => {
          const r = setOfficerPhoto(c.id, target, uri, capturedAt);
          if (!r.ok) {
            setSaveError(describeDomainError(r.error).message);
            return;
          }
          // Single-shot: return to the same inspection screen (pop, not push).
          goBack();
        }}
        onContinue={goBack}
        onClose={goBack}
        continueLabel="Done"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  stateText: { padding: 24, color: colors.textSecondary, fontSize: 14, textAlign: "center" },
});
