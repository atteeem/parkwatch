import React, { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CameraCapture, CaptureSlot } from "../../../src/components/CameraCapture";
import { ReportStepper } from "../../../src/components/ReportStepper";
import { useReportDraft } from "../../../src/context/ReportContext";
import { CitizenEvidenceType, isDraftValid, qualifiesAsRequiredEvidence } from "../../../src/domain";
import { afterStep, CITIZEN_PHOTO_SLOTS, nextMissingSlot } from "../../../src/presentation/reportDraft";
import { CITIZEN_CAMERA_GUIDE, CITIZEN_SHOT_INSTRUCTION } from "../../../src/presentation/cameraGuides";
import { haptics } from "../../../src/feedback/haptics";
import { VehicleTypeChip, VehicleTypePicker } from "../../../src/components/cameraGuides/VehicleTypePicker";

/** T9.4 spike: post-capture vehicle check on all three citizen photos (assistance only). */
const CITIZEN_VEHICLE_CHECK_SLOTS = ["FRONT", "SIDE", "REAR"] as const;

export default function ReportPhotos() {
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const { draft, capturePhoto, setGuideVehicleType } = useReportDraft();
  const [selected, setSelected] = useState<CitizenEvidenceType | undefined>(undefined);
  // The body type is asked once at the start (it only shapes the framing outline);
  // "Not sure" / closing the sheet uses a generic car. It stays for every shot and retake.
  const [typeSheet, setTypeSheet] = useState(draft.guideVehicleType === undefined);

  const slots: CaptureSlot[] = CITIZEN_PHOTO_SLOTS.map(({ slot, label }) => {
    const photo = draft.photos[slot];
    return { key: slot, label, done: !!photo && qualifiesAsRequiredEvidence(photo) };
  });
  const activeSlot = selected ?? nextMissingSlot(draft);

  return (
    <>
      <CameraCapture
        headerTitle="Report a Parking Violation"
        vehicleCheckSlots={CITIZEN_VEHICLE_CHECK_SLOTS}
        stepper={<ReportStepper activeStep={1} />}
        instructionTitle="Take 3 Photos"
        instructionBody={
          activeSlot
            ? CITIZEN_SHOT_INSTRUCTION[activeSlot]
            : "All 3 photos are taken. Tap a photo below to retake it, or continue."
        }
        guide={activeSlot ? CITIZEN_CAMERA_GUIDE[activeSlot] : undefined}
        guideProfile={draft.guideVehicleType ?? "GENERIC"}
        accessory={<VehicleTypeChip profile={draft.guideVehicleType} onPress={() => setTypeSheet(true)} />}
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
      <VehicleTypePicker
        visible={typeSheet}
        selected={draft.guideVehicleType}
        onSelect={(p) => {
          setGuideVehicleType(p);
          setTypeSheet(false);
        }}
        onClose={() => {
          if (draft.guideVehicleType === undefined) setGuideVehicleType("GENERIC");
          setTypeSheet(false);
        }}
      />
    </>
  );
}
