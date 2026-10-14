// Plate scanner with recognition (rendered). The camera module is replaced by
// a stand-in (permission granted, camera ready); capture and recognition are
// injected fakes. Nothing reaches a real service.
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { PlateScanner } from "../plate/PlateScanner";
import type { PlateRecognitionResponse } from "../../../supabase/functions/_shared/plateText";
import type { RecognitionOutcome } from "../../presentation/plateScanFlow";

jest.mock("expo-camera", () => {
  const R = require("react");
  const { View } = require("react-native");
  const CameraView = R.forwardRef((props: { onCameraReady?: () => void }, ref: unknown) => {
    R.useImperativeHandle(ref, () => ({ takePictureAsync: jest.fn() }));
    R.useEffect(() => props.onCameraReady?.(), []);
    return R.createElement(View, { testID: "camera" });
  });
  return { CameraView, useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()] };
});

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const texts = (r: TestRenderer.ReactTestRenderer) => r.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
const button = (r: TestRenderer.ReactTestRenderer, label: string) => r.root.find((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === "function");
const resp = (over: Partial<PlateRecognitionResponse> = {}): PlateRecognitionResponse => ({
  plate: "NNC-685",
  normalized: "NNC685",
  confidence: 0.94,
  country: "FI",
  candidates: [{ plate: "NNC-685", normalized: "NNC685", confidence: 0.94 }],
  provider: "mock",
  ...over,
});

function setup(outcome: RecognitionOutcome | Promise<RecognitionOutcome>, opts: { crop?: unknown } = {}) {
  const recognize = jest.fn(() => Promise.resolve(outcome));
  const capture = jest.fn(async () => (opts.crop === undefined ? { base64: "/9j/crop", mimeType: "image/jpeg" as const } : opts.crop)) as never;
  const onUsePlate = jest.fn();
  const onEnterManually = jest.fn();
  let r!: TestRenderer.ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <PlateScanner visible initialPlate="" recognize={recognize} capture={capture} onUsePlate={onUsePlate} onEnterManually={onEnterManually} onClose={jest.fn()} />
      </SafeAreaProvider>
    );
  });
  return { r, recognize, capture, onUsePlate, onEnterManually };
}

const scan = async (r: TestRenderer.ReactTestRenderer) => {
  await act(async () => {
    button(r, "Scan plate").props.onPress();
  });
};

describe("PlateScanner with recognition", () => {
  it("Scan plate -> Reading plate… -> NNC-685 to confirm; only 'Use NNC-685' fills the plate", async () => {
    let resolve!: (o: RecognitionOutcome) => void;
    const pending = new Promise<RecognitionOutcome>((res) => (resolve = res));
    const s = setup(pending);
    expect(texts(s.r)).toContain("Position the registration plate inside the frame");
    await scan(s.r);
    expect(texts(s.r)).toContain("Reading plate…");
    expect(s.capture).toHaveBeenCalledTimes(1);
    expect(s.recognize).toHaveBeenCalledWith({ base64: "/9j/crop", mimeType: "image/jpeg" }); // only the crop is sent
    await act(async () => resolve({ ok: true, value: resp() }));
    expect(texts(s.r)).toEqual(expect.arrayContaining(["Recognised plate", "NNC-685"]));
    expect(s.onUsePlate).not.toHaveBeenCalled(); // never auto-accepted
    act(() => button(s.r, "Use NNC-685").props.onPress());
    expect(s.onUsePlate).toHaveBeenCalledWith("NNC-685");
  });

  it("Edit: the recognised text can be corrected before use", async () => {
    const s = setup({ ok: true, value: resp() });
    await scan(s.r);
    act(() => button(s.r, "Edit").props.onPress());
    const input = s.r.root.find((n) => n.props.accessibilityLabel === "Licence plate" && typeof n.props.onChangeText === "function");
    expect(input.props.value).toBe("NNC-685");
    act(() => input.props.onChangeText("nmc-685"));
    act(() => button(s.r, "Use this plate").props.onPress());
    expect(s.onUsePlate).toHaveBeenCalledWith("NMC-685");
  });

  it("medium confidence explicitly asks the citizen to check", async () => {
    const s = setup({ ok: true, value: resp({ confidence: 0.7, candidates: [{ plate: "NNC-685", normalized: "NNC685", confidence: 0.7 }] }) });
    await scan(s.r);
    expect(texts(s.r)).toContain("Check the plate matches the vehicle");
    expect(texts(s.r).join(" ")).not.toMatch(/0\.7|70 ?%/); // no raw scores
  });

  it("no result / low confidence: Couldn't read the plate, Try again or Enter manually", async () => {
    const s = setup({ ok: true, value: resp({ plate: null, normalized: null, confidence: 0.42, candidates: [] }) });
    await scan(s.r);
    expect(texts(s.r)).toEqual(expect.arrayContaining(["Couldn't read the plate", "Try again or enter it manually."]));
    act(() => button(s.r, "Try again").props.onPress());
    expect(texts(s.r)).toContain("Position the registration plate inside the frame");
    act(() => button(s.r, "Enter manually").props.onPress());
    expect(s.onEnterManually).toHaveBeenCalled();
  });

  it("network failure / service unavailable: plain message, manual entry still offered", async () => {
    const s = setup({ ok: false, error: "UNAVAILABLE" });
    await scan(s.r);
    expect(texts(s.r)).toEqual(expect.arrayContaining(["Recognition service unavailable", "You can still enter the plate manually."]));
    expect(button(s.r, "Enter manually")).toBeTruthy();
    const n = setup({ ok: false, error: "NETWORK" });
    await scan(n.r);
    expect(texts(n.r)).toContain("No connection");
  });

  it("several close readings: 'Which plate is correct?' with the options", async () => {
    const s = setup({
      ok: true,
      value: resp({ confidence: 0.82, candidates: [{ plate: "NNC-685", normalized: "NNC685", confidence: 0.82 }, { plate: "NMC-685", normalized: "NMC685", confidence: 0.78 }] }),
    });
    await scan(s.r);
    expect(texts(s.r)).toEqual(expect.arrayContaining(["Which plate is correct?", "NNC-685", "NMC-685"]));
    act(() => button(s.r, "Use NMC-685").props.onPress());
    expect(s.onUsePlate).toHaveBeenCalledWith("NMC-685");
  });

  it("a picture that can't be taken never calls the service", async () => {
    const s = setup({ ok: true, value: resp() }, { crop: null });
    await scan(s.r);
    expect(s.recognize).not.toHaveBeenCalled();
    expect(texts(s.r)).toContain("Couldn't take the picture");
  });
});
