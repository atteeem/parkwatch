import React, { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CameraCapture, CaptureSlot } from "../../../src/components/CameraCapture";
import { ReportStepper } from "../../../src/components/ReportStepper";
import { useReportDraft } from "../../../src/context/ReportContext";
import { CitizenEvidenceType, isDraftValid, qualifiesAsRequiredEvidence } from "../../../src/domain";
import { afterStep, CITIZEN_PHOTO_SLOTS, nextMissingSlot } from "../../../src/presentation/reportDraft";
import { CITIZEN_CAMERA_GUIDE } from "../../../src/presentation/cameraGuides";import { haptics } from "../../../src/feedback/haptics";


export default function ReportPhotos() {
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const { draft, capturePhoto } = useReportDraft();
  const [selected, setSelected] = useState<CitizenEvidenceType | undefined>(undefined);

  const slots: CaptureSlot[] = CITIZEN_PHOTO_SLOTS.map(({ slot, label }) => {
    const photo = draft.photos[slot];
    return { key: slot, label, done: !!photo && qualifiesAsRequiredEvidence(photo) };
  });
  const activeSlot = selected ?? nextMissingSlot(draft);

  return (
    <CameraCapture
      headerTitle="Report a Parking Violation"
      stepper={<ReportStepper activeStep={1} />}
      instructionTitle="Take 3 Photos"
      instructionBody={
        activeSlot
          ? "Line the vehicle up with the guide and take a clear photo."
          : "All 3 photos are taken. Tap a photo below to retake it, or continue."
      }
      guide={activeSlot ? CITIZEN_CAMERA_GUIDE[activeSlot] : undefined}
      slots={slots}
      activeSlotKey={activeSlot}
      onSelectSlot={(key) => setSelected(key as CitizenEvidenceType)}
      onCapturePhoto={(slotKey, uri, capturedAt) => {
        capturePhoto(slotKey as CitizenEvidenceType, uri, capturedAt);
        haptics.success("photoSaved");
        setSelected(undefined); // advance to the next missing angle
      }}
      onContinue={() => {
        if (!isDraftValid(draft, "PHOTOS")) return;
        const step = afterStep("photos", from);
        if (step.kind === "backToReview") router.back();
        else router.push(step.route);
      }}
      onClose={() => (router.canGoBack() ? router.back() : router.replace("/user/home"))}
    />
  );
}
