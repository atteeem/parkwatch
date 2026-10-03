import React, { useState } from "react";
import { useRouter } from "expo-router";
import { CameraCapture, CaptureSlot } from "../../../src/components/CameraCapture";
import { ReportStepper } from "../../../src/components/ReportStepper";
import { useReportDraft } from "../../../src/context/ReportContext";
import { CitizenEvidenceType, isDraftValid, qualifiesAsRequiredEvidence } from "../../../src/domain";
import { CITIZEN_PHOTO_SLOTS, nextMissingSlot } from "../../../src/presentation/reportDraft";

export default function ReportPhotos() {
  const router = useRouter();
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
      instructionBody="Please take clear photos of the vehicle from all 3 angles."
      slots={slots}
      activeSlotKey={activeSlot}
      onSelectSlot={(key) => setSelected(key as CitizenEvidenceType)}
      onCapturePhoto={(slotKey, uri, capturedAt) => {
        capturePhoto(slotKey as CitizenEvidenceType, uri, capturedAt);
        setSelected(undefined); // advance to the next missing angle
      }}
      onContinue={() => {
        if (isDraftValid(draft, "PHOTOS")) router.push("/user/report/select-violation");
      }}
      onClose={() => (router.canGoBack() ? router.back() : router.replace("/user/home"))}
    />
  );
}
