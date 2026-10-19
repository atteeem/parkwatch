// T9.4 spike: the exact phone failure - the native "NitroModules" TurboModule
// is missing from the app binary. Opening the camera must never crash: no red
// screen, no evaluation of the detector's JavaScript, a dev-only diagnostic,
// and a fully working normal camera.
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { DETECTOR_UNAVAILABLE_COPY, guardedRequire, probeNativeDetector, ProbeEnv } from "../nativeDetectorProbe";

const mockNative = { nitro: null as null | { install: () => string | undefined }, tfliteEvaluated: 0 };

jest.mock("react-native", () => {
  const RN = jest.requireActual("react-native");
  RN.TurboModuleRegistry.get = (name: string) => (name === "NitroModules" ? mockNative.nitro : null);
  return RN;
});
jest.mock("expo-constants", () => ({ __esModule: true, default: { executionEnvironment: "bare" } }));
// Behaves like react-native-nitro-modules when the native module is absent: throws while being evaluated.
jest.mock("react-native-fast-tflite", () => {
  mockNative.tfliteEvaluated++;
  throw new Error('Failed to get NitroModules: The native "NitroModules" Turbo/Native-Module could not be found.');
});
jest.mock("expo-camera", () => {
  const R = require("react");
  const { View } = require("react-native");
  const CameraView = R.forwardRef((_p: unknown, ref: unknown) => {
    R.useImperativeHandle(ref, () => ({ takePictureAsync: jest.fn(async () => ({ uri: "file:///cache/p.jpg" })) }));
    return R.createElement(View, { testID: "camera" });
  });
  return { CameraView, useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()] };
});

const env = (over: Partial<ProbeEnv> = {}): ProbeEnv => ({
  executionEnvironment: "bare",
  getTurboModule: () => null,
  getProxy: () => undefined,
  jsNitroVersion: "0.37.1",
  ...over,
});
const proxy = (names: string[], version = "0.37.1") => ({ version, hasHybridObject: (n: string) => names.includes(n), getAllHybridObjectNames: () => names });

describe("probeNativeDetector (never throws, exact reason)", () => {
  it("NitroModules missing from the binary", () => {
    expect(probeNativeDetector(env())).toMatchObject({ ok: false, reason: "NITRO_NOT_IN_BINARY" });
  });
  it("Expo Go, install failure, version mismatch, TFLite missing, ok", () => {
    expect(probeNativeDetector(env({ executionEnvironment: "storeClient" }))).toMatchObject({ reason: "EXPO_GO" });
    expect(probeNativeDetector(env({ getTurboModule: () => ({ install: () => "jsContext is null" }) }))).toMatchObject({ reason: "NITRO_INSTALL_FAILED", detail: "jsContext is null" });
    let installed: ReturnType<typeof proxy> | undefined;
    const tm = { install: () => ((installed = proxy(["TfliteModule", "AssetLoader"])), undefined) };
    expect(probeNativeDetector(env({ getTurboModule: () => tm, getProxy: () => installed }))).toEqual({ ok: true, nitroVersion: "0.37.1" });
    expect(probeNativeDetector(env({ getProxy: () => proxy(["TfliteModule", "AssetLoader"], "0.35.2") }))).toMatchObject({ reason: "NITRO_VERSION_MISMATCH" });
    expect(probeNativeDetector(env({ getProxy: () => proxy([]) }))).toMatchObject({ reason: "TFLITE_NOT_IN_BINARY" });
    expect(probeNativeDetector(env({ getTurboModule: () => { throw new Error("boom"); } }))).toMatchObject({ reason: "PROBE_ERROR", detail: "boom" });
  });
});

describe("guardedRequire (Metro reports module-evaluation errors as fatal)", () => {
  it("captures a fatal report instead of a red screen and restores the handler", () => {
    const original = jest.fn();
    let handler: (e: unknown, f?: boolean) => void = original;
    const eu = { getGlobalHandler: () => handler, setGlobalHandler: (h: typeof handler) => void (handler = h) };
    // what Metro's guardedLoadModule does: report via ErrorUtils, then return undefined
    const r = guardedRequire(() => (handler(new Error("NitroModules could not be found"), true), undefined), eu);
    expect(r).toEqual({ error: "NitroModules could not be found" });
    expect(original).not.toHaveBeenCalled();
    expect(handler).toBe(original);
    expect(guardedRequire(() => { throw new Error("x"); }, eu)).toEqual({ error: "x" });
    expect(guardedRequire(() => ({ ok: 1 }), eu)).toEqual({ value: { ok: 1 } });
  });
});

describe("the exact device failure: NativeNitroModules does not exist", () => {
  beforeEach(() => {
    mockNative.nitro = null;
    mockNative.tfliteEvaluated = 0;
  });

  it("getVehicleEngine() resolves null with the reason, and the detector JS is never evaluated", async () => {
    let eng!: typeof import("../tfliteVehicleEngine");
    jest.isolateModules(() => {
      eng = require("../tfliteVehicleEngine");
    });
    await expect(eng.getVehicleEngine()).resolves.toBeNull();
    expect(eng.getVehicleDetectorStatus()).toMatchObject({ ok: false, reason: "NITRO_NOT_IN_BINARY" });
    expect(mockNative.tfliteEvaluated).toBe(0);
  });

  it("Create Report camera opens, shows 'Vehicle detector unavailable' (dev) and still takes and saves photos", async () => {
    const { CameraCapture } = require("../../components/CameraCapture") as typeof import("../../components/CameraCapture");
    const onCapturePhoto = jest.fn(async (_s: string, _u: string, _a: string) => undefined);
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(
        <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
          <CameraCapture headerTitle="Report" instructionTitle="I" instructionBody="B" slots={[{ key: "FRONT", label: "Front Photo", done: false }]} vehicleCheckSlots={["FRONT"]} onCapturePhoto={onCapturePhoto} onContinue={jest.fn()} onClose={jest.fn()} />
        </SafeAreaProvider>
      );
    });
    await act(async () => undefined);
    const texts = () => r.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
    expect(texts()).toContain(DETECTOR_UNAVAILABLE_COPY);
    expect(texts().join(" ")).toMatch(/NITRO_NOT_IN_BINARY/);
    const shutter = r.root.find((n) => n.props.accessibilityLabel === "Take photo: Front Photo" && typeof n.props.onPress === "function");
    expect(shutter.props.disabled).toBe(false);
    await act(async () => {
      await shutter.props.onPress();
    });
    expect(onCapturePhoto).toHaveBeenCalledWith("FRONT", "file:///cache/p.jpg", expect.any(String));
    expect(texts()).not.toContain("We couldn't detect a vehicle in this photo.");
    expect(mockNative.tfliteEvaluated).toBe(0);
  });
});
