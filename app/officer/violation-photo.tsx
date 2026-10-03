import React from "react";
import { useRouter, useLocalSearchParams } from "expo-router";
import { CameraCapture, CaptureSlot } from "../../src/components/CameraCapture";
import { useApp } from "../../src/context/AppContext";

export default function OfficerViolationPhoto() {
  const router = useRouter();
  const { id, target, label } = useLocalSearchParams<{ id: string; target: string; label: string }>();
  const { officerDraft, setOfficerPhoto } = useApp();

  const targetKey = target as keyof typeof officerDraft.officerPhotos;
  const slots: CaptureSlot[] = [
    { key: targetKey, label: label ?? "Photo", done: !!officerDraft.officerPhotos[targetKey] },
  ];

  const goBackToInspection = () => router.replace({ pathname: "/officer/inspection", params: { id } });

  return (
    <CameraCapture
      headerTitle={label ?? "Capture Photo"}
      instructionTitle="Capture Evidence"
      instructionBody={`Take a clear photo for: ${label ?? "this requirement"}.`}
      slots={slots}
      onCapturePhoto={(slotKey, uri) => {
        setOfficerPhoto(slotKey as keyof typeof officerDraft.officerPhotos, uri);
        // Officer photos are single-shot — return to the inspection
        // checklist immediately instead of the multi-photo "Next" flow.
        setTimeout(goBackToInspection, 200);
      }}
      onContinue={goBackToInspection}
      onClose={goBackToInspection}
      continueLabel="Done"
    />
  );
}
