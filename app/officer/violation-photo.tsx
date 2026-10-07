import React, { useState } from "react";
import { Text, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { CameraCapture, CaptureSlot } from "../../src/components/CameraCapture";
import { BackHeader } from "../../src/components/Header";
import { colors } from "../../src/constants/colors";
import { settle, useApp, useCaseDetailLoad } from "../../src/context/AppContext";
import { DetailLoading } from "../../src/components/CoreDataGate";
import { describeDomainError } from "../../src/presentation/errors";
import { OFFICER_PHOTO_KEY_TO_TYPE, OfficerPhotoKey } from "../../src/presentation/viewModels";
import {
  activeOfficerSlot,
  afterOfficerSave,
  initialOfficerCapture,
  OFFICER_CAPTURE_ORDER,
  OFFICER_PHOTO_LABEL,
  officerCaptureComplete,
  selectOfficerSlot,
} from "../../src/presentation/officerCapture";
import { OFFICER_CAMERA_GUIDE } from "../../src/presentation/cameraGuides";

const SLOT_ICON: Record<OfficerPhotoKey, keyof typeof Ionicons.glyphMap> = {
  front: "car-outline",
  plate: "pricetag-outline",
  sign: "flag-outline",
  rear: "car-outline",
};

// OFF-07. One continuous evidence session for THIS case's inspection (source
// CAMERA): Vehicle front -> License plate -> Parking sign -> Vehicle rear.
// After each SAVED photo the camera moves on to the next missing target and
// stays open; a failed upload stays on the same target with the error. Any
// captured target can be tapped for a retake. Close / Done returns to the
// inspection; saved photos are kept.
export default function OfficerViolationPhoto() {
  const router = useRouter();
  const { id, target } = useLocalSearchParams<{ id: string; target?: string }>();
  // Server mode: (re)load this case when the screen opens, so it is current even off the loaded pages.
  const caseLoad = useCaseDetailLoad(id);
  const { getCase, getInspection, setOfficerPhoto } = useApp();
  const [flow, setFlow] = useState(() => initialOfficerCapture(target));
  const [saving, setSaving] = useState(false);
  const c = getCase(id);
  const inspection = c ? getInspection(c.id) : undefined;
  const goBack = () =>
    router.canGoBack() ? router.back() : router.replace({ pathname: "/officer/inspection", params: { id } });

  if (caseLoad.loading && (!c || !inspection?.exists)) return <DetailLoading />;

  if (!c || !inspection?.exists) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <BackHeader title="Capture Photos" onBack={goBack} />
        <Text style={styles.stateText}>{!c ? "This case could not be found." : "The inspection for this case has not started."}</Text>
      </SafeAreaView>
    );
  }

  const photos = inspection.officerPhotos;
  const active = activeOfficerSlot(flow, photos);
  const complete = officerCaptureComplete(photos);
  const slots: CaptureSlot[] = OFFICER_CAPTURE_ORDER.map((k) => ({ key: k, label: OFFICER_PHOTO_LABEL[k], done: !!photos[k], icon: SLOT_ICON[k] }));
  const done = slots.filter((s) => s.done).length;

  const instruction = flow.error
    ? flow.error
    : active
      ? `${photos[active] ? "Retake" : "Take"}: ${OFFICER_PHOTO_LABEL[active]} (${done} of 4 saved)`
      : "All four photos are saved. Tap a photo below to retake it, or tap the arrow to finish.";

  return (
    <View style={{ flex: 1 }}>
      <CameraCapture
        headerTitle="Officer Photos"
        instructionTitle={flow.error ? "Photo not saved" : complete && !flow.selected ? "Evidence complete" : "Capture Evidence"}
        instructionBody={instruction}
        slots={slots}
        activeSlotKey={active}
        guide={active ? OFFICER_CAMERA_GUIDE[OFFICER_PHOTO_KEY_TO_TYPE[active]] : undefined}
        busyLabel={saving ? "Uploading photo…" : undefined}
        onSelectSlot={(key) => setFlow((f) => selectOfficerSlot(f, key as OfficerPhotoKey))}
        onCapturePhoto={async (slotKey, uri, capturedAt) => {
          const slot = slotKey as OfficerPhotoKey;
          setSaving(true);
          setFlow((f) => ({ ...f, error: null }));
          const r = await settle(setOfficerPhoto(c.id, slot, uri, capturedAt));
          setSaving(false);
          // Saved -> next missing target (camera stays open). Failed -> same target + error.
          setFlow((f) => afterOfficerSave(f, slot, r.ok ? { ok: true } : { ok: false, message: describeDomainError(r.error).message }));
        }}
        onContinue={goBack}
        onClose={goBack}
        continueLabel="Done, back to inspection"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  stateText: { padding: 24, color: colors.textSecondary, fontSize: 14, textAlign: "center" },
});
