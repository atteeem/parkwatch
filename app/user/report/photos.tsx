import React from "react";
import { useRouter } from "expo-router";
import { CameraCapture, CaptureSlot } from "../../../src/components/CameraCapture";
import { ReportStepper } from "../../../src/components/ReportStepper";
import { useReportDraft } from "../../../src/context/ReportContext";

export default function ReportPhotos() {
  const router = useRouter();
  const { draft, setPhoto } = useReportDraft();

  const slots: CaptureSlot[] = [
    { key: "front", label: "Front", done: !!draft.photos.front },
    { key: "side", label: "Side", done: !!draft.photos.side },
    { key: "rear", label: "Rear", done: !!draft.photos.rear },
  ];

  return (
    <CameraCapture
      headerTitle="Report a Parking Violation"
      stepper={<ReportStepper activeStep={1} />}
      instructionTitle="Take 3 Photos"
      instructionBody="Please take clear photos of the vehicle from all 3 angles."
      slots={slots}
      onCapturePhoto={(slotKey, uri) => setPhoto(slotKey as "front" | "side" | "rear", uri)}
      onContinue={() => router.push("/user/report/select-violation")}
      onClose={() => router.push("/user/home")}
    />
  );
}
