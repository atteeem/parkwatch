// T9.4 spike: post-capture vehicle check. Deterministic: the native pipeline
// is a fake engine / injected checker; nothing reaches a model or a network.
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text } from "react-native";
import * as fs from "fs";
import * as path from "path";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { checkVehiclePhoto, Detection, interpretDetections, OutputTensor, parseDetectionOutputs, VEHICLE_CLASSES, VehicleCheckResult, VehicleEngine } from "../vehicleCheck";
import { CameraCapture, CaptureSlot, VEHICLE_CHECK_COPY } from "../../components/CameraCapture";

jest.mock("../tfliteVehicleEngine", () => ({ getVehicleEngine: jest.fn(async () => null), startFrameMonitor: () => () => undefined }));
jest.mock("expo-camera", () => {
  const R = require("react");
  const { View } = require("react-native");
  const CameraView = R.forwardRef((_p: unknown, ref: unknown) => {
    R.useImperativeHandle(ref, () => ({ takePictureAsync: jest.fn(async () => ({ uri: "file:///cache/photo-1.jpg" })) }));
    return R.createElement(View, { testID: "camera" });
  });
  return { CameraView, useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()] };
});

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const car = (score: number, box: Detection["box"] = [0.2, 0.1, 0.8, 0.9]): Detection => ({ classId: 2, score, box });

describe("interpretDetections: only 'is a plausible vehicle present?'", () => {
  it("car, truck, bus and motorcycle all count; the type need not match the chosen guide", () => {
    expect(VEHICLE_CLASSES).toEqual({ 2: "car", 3: "motorcycle", 5: "bus", 7: "truck" });
    for (const classId of [2, 3, 5, 7]) expect(interpretDetections([{ classId, score: 0.6, box: [0.1, 0.1, 0.9, 0.9] }]).found).toBe(true);
  });
  it("non-vehicles, low scores and tiny far-away boxes do not count", () => {
    expect(interpretDetections([{ classId: 0, score: 0.99, box: [0, 0, 1, 1] }]).found).toBe(false); // person
    expect(interpretDetections([{ classId: 12, score: 0.9, box: [0, 0, 1, 1] }]).found).toBe(false); // stop sign is not a vehicle
    expect(interpretDetections([car(0.2)])).toEqual({ found: false, best: { label: "car", score: 0.2 } });
    expect(interpretDetections([car(0.9, [0.5, 0.5, 0.55, 0.55])]).found).toBe(false); // 0.25% of the frame
    expect(interpretDetections([]).found).toBe(false);
  });
  it("partial / close-up vehicles (box touching the edges) still count", () => {
    expect(interpretDetections([car(0.45, [-0.1, -0.2, 1.1, 0.7])]).found).toBe(true);
  });
});

describe("parseDetectionOutputs (TFLite_Detection_PostProcess)", () => {
  const out = (order: "named" | "unnamed"): OutputTensor[] => [
    { name: order === "named" ? "location" : "t0", shape: [1, 3, 4], data: new Float32Array([0.1, 0.1, 0.9, 0.9, 0, 0, 0.1, 0.1, 0, 0, 0, 0]) },
    { name: order === "named" ? "category" : "t1", shape: [1, 3], data: new Float32Array([2, 0, 7]) },
    { name: order === "named" ? "score" : "t2", shape: [1, 3], data: new Float32Array([0.8, 0.5, 0.1]) },
    { name: order === "named" ? "number of detections" : "t3", shape: [1], data: new Float32Array([2]) },
  ];
  it("by name, and by shape/value range when names are generic; respects the count", () => {
    for (const o of ["named", "unnamed"] as const) {
      const d = parseDetectionOutputs(out(o));
      expect(d).toHaveLength(2);
      expect(d[0]).toMatchObject({ classId: 2 });
      expect(d[0]!.score).toBeCloseTo(0.8);
    }
    const swapped = out("unnamed");
    [swapped[1], swapped[2]] = [swapped[2]!, swapped[1]!];
    expect(parseDetectionOutputs(swapped)[0]).toMatchObject({ classId: 2 });
  });
  it("unexpected outputs give no detections (never a crash)", () => {
    expect(parseDetectionOutputs([])).toEqual([]);
    expect(parseDetectionOutputs([{ shape: [1, 10], data: new Float32Array(10) }])).toEqual([]);
  });
});

describe("checkVehiclePhoto pipeline", () => {
  const outputs = (scores: number[], classes: number[]): OutputTensor[] => [
    { name: "location", shape: [1, scores.length, 4], data: new Float32Array(scores.flatMap(() => [0.1, 0.1, 0.9, 0.9])) },
    { name: "category", shape: [1, scores.length], data: new Float32Array(classes) },
    { name: "score", shape: [1, scores.length], data: new Float32Array(scores) },
    { name: "count", shape: [1], data: new Float32Array([scores.length]) },
  ];
  const engine = (over: Partial<VehicleEngine> = {}, outs = outputs([0.7], [2])) => {
    const calls: string[] = [];
    const e: VehicleEngine = {
      prepare: async () => void calls.push("prepare"),
      resize: async (uri) => (calls.push(`resize:${uri}`), new Uint8Array([0xff, 0xd8])),
      decode: (b) => (calls.push(`decode:${b.length}`), { rgb: new Uint8Array(320 * 320 * 3), width: 320, height: 320 }),
      toTensor: (rgb) => (calls.push(`tensor:${rgb.length}`), rgb.buffer as ArrayBuffer),
      infer: async () => (calls.push("infer"), outs),
      ...over,
    };
    return { e, calls };
  };
  const clock = () => {
    let t = 0;
    return () => (t += 10);
  };

  it("runs resize -> decode (small image only) -> tensor -> inference, timing each step", async () => {
    const { e, calls } = engine();
    const r = await checkVehiclePhoto("file:///photo.jpg", e, { now: clock(), startFrameMonitor: () => () => 16 });
    expect(r.kind).toBe("FOUND");
    expect(calls).toEqual(["prepare", "resize:file:///photo.jpg", "decode:2", `tensor:${320 * 320 * 3}`, "infer"]);
    expect(r.timings).toMatchObject({ resizeMs: 10, decodeMs: 10, tensorMs: 10, inferenceMs: 10, maxFrameGapMs: 16 });
    expect(r.timings!.totalMs).toBeGreaterThan(0);
  });
  it("no vehicle -> NOT_FOUND with the best guess for diagnostics", async () => {
    const r = await checkVehiclePhoto("u", engine({}, outputs([0.9, 0.2], [0, 2])).e);
    expect(r).toMatchObject({ kind: "NOT_FOUND", best: { label: "car" } });
  });
  it("missing engine, any error, or a timeout -> UNAVAILABLE (the camera continues normally)", async () => {
    expect((await checkVehiclePhoto("u", null)).kind).toBe("UNAVAILABLE");
    expect(await checkVehiclePhoto("u", engine({ infer: async () => Promise.reject(new Error("native")) }).e)).toMatchObject({ kind: "UNAVAILABLE", reason: "ERROR" });
    expect(await checkVehiclePhoto("u", engine({ decode: () => { throw new Error("bad jpeg"); } }).e)).toMatchObject({ kind: "UNAVAILABLE", reason: "ERROR" });
    expect(await checkVehiclePhoto("u", engine({ prepare: () => new Promise(() => undefined) }).e, { timeoutMs: 20 })).toMatchObject({ kind: "UNAVAILABLE", reason: "TIMEOUT" });
  });
});

describe("CameraCapture with the post-capture vehicle check", () => {
  const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
  const SLOTS: CaptureSlot[] = [
    { key: "FRONT", label: "Front Photo", done: false },
    { key: "SIDE", label: "Side Photo", done: false },
  ];
  const texts = (r: TestRenderer.ReactTestRenderer) => r.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
  const press = async (r: TestRenderer.ReactTestRenderer, label: string) => {
    const b = r.root.find((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === "function");
    await act(async () => {
      await b.props.onPress();
    });
  };
  function setup(checker: jest.Mock, slotsToCheck: readonly string[] = ["FRONT", "SIDE"], slots = SLOTS) {
    const onCapturePhoto = jest.fn(async (_slot: string, _uri: string, _at: string) => undefined);
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(
        <SafeAreaProvider initialMetrics={METRICS}>
          <CameraCapture headerTitle="T" instructionTitle="I" instructionBody="B" slots={slots} onCapturePhoto={onCapturePhoto} onContinue={jest.fn()} onClose={jest.fn()} vehicleCheckSlots={slotsToCheck} vehicleChecker={checker} />
        </SafeAreaProvider>
      );
    });
    return { r, onCapturePhoto };
  }
  const result = (kind: VehicleCheckResult["kind"]): VehicleCheckResult =>
    kind === "FOUND" ? { kind, best: { label: "car", score: 0.8 }, timings: { totalMs: 300 } } : kind === "NOT_FOUND" ? { kind, timings: { totalMs: 300 } } : { kind, reason: "ERROR" };

  it("vehicle detected -> 'Vehicle detected ✓' and the photo continues normally (same arguments as before)", async () => {
    const { r, onCapturePhoto } = setup(jest.fn(async () => result("FOUND")));
    await press(r, "Take photo: Front Photo");
    expect(texts(r)).toContain(VEHICLE_CHECK_COPY.detected);
    expect(onCapturePhoto).toHaveBeenCalledTimes(1);
    expect(onCapturePhoto.mock.calls[0]).toEqual(["FRONT", "file:///cache/photo-1.jpg", expect.any(String)]);
  });

  it("'Checking photo…' is shown while the check runs, and the shutter is locked", async () => {
    let finish!: (v: VehicleCheckResult) => void;
    const { r } = setup(jest.fn(() => new Promise<VehicleCheckResult>((res) => (finish = res))));
    act(() => {
      void r.root.find((n) => n.props.accessibilityLabel === "Take photo: Front Photo" && typeof n.props.onPress === "function").props.onPress();
    });
    await act(async () => undefined);
    expect(texts(r)).toContain(VEHICLE_CHECK_COPY.checking);
    const shutter = r.root.find((n) => n.props.accessibilityLabel === "Take photo: Front Photo" && typeof n.props.onPress === "function");
    expect(shutter.props.disabled).toBe(true);
    await act(async () => finish(result("FOUND")));
  });

  it("no vehicle -> message with Retake and Use photo anyway; nothing is saved until the user decides", async () => {
    const { r, onCapturePhoto } = setup(jest.fn(async () => result("NOT_FOUND")));
    await press(r, "Take photo: Front Photo");
    expect(texts(r)).toContain(VEHICLE_CHECK_COPY.notFoundTitle);
    expect(onCapturePhoto).not.toHaveBeenCalled();
    await press(r, VEHICLE_CHECK_COPY.retake);
    expect(texts(r)).not.toContain(VEHICLE_CHECK_COPY.notFoundTitle);
    expect(onCapturePhoto).not.toHaveBeenCalled();
    const shutter = r.root.find((n) => n.props.accessibilityLabel === "Take photo: Front Photo" && typeof n.props.onPress === "function");
    expect(shutter.props.disabled).toBe(false); // retake possible at once
  });

  it("Use photo anyway always works and saves exactly that photo", async () => {
    const { r, onCapturePhoto } = setup(jest.fn(async () => result("NOT_FOUND")));
    await press(r, "Take photo: Front Photo");
    await press(r, VEHICLE_CHECK_COPY.useAnyway);
    expect(onCapturePhoto).toHaveBeenCalledTimes(1);
    expect(onCapturePhoto.mock.calls[0]![0]).toBe("FRONT");
    expect(onCapturePhoto.mock.calls[0]![1]).toBe("file:///cache/photo-1.jpg");
  });

  it("detector unavailable or throwing -> the normal camera flow, no message", async () => {
    for (const checker of [jest.fn(async () => result("UNAVAILABLE")), jest.fn(async () => Promise.reject(new Error("crash")))]) {
      const { r, onCapturePhoto } = setup(checker);
      await press(r, "Take photo: Front Photo");
      expect(onCapturePhoto).toHaveBeenCalledTimes(1);
      expect(texts(r)).not.toContain(VEHICLE_CHECK_COPY.notFoundTitle);
    }
  });

  it("slots that are not listed are never checked (officer plate / sign)", async () => {
    const checker = jest.fn(async () => result("NOT_FOUND"));
    const { r, onCapturePhoto } = setup(checker, ["front", "rear"], [{ key: "plate", label: "License Plate", done: false }]);
    await press(r, "Take photo: License Plate");
    expect(checker).not.toHaveBeenCalled();
    expect(onCapturePhoto).toHaveBeenCalledTimes(1);
  });
});

describe("wiring, privacy and enforcement boundaries", () => {
  it("citizen Front/Side/Rear and officer Front/Rear only", () => {
    expect(read("app/user/report/photos.tsx")).toMatch(/CITIZEN_VEHICLE_CHECK_SLOTS = \["FRONT", "SIDE", "REAR"\] as const/);
    expect(read("app/officer/violation-photo.tsx")).toMatch(/OFFICER_VEHICLE_CHECK_SLOTS: readonly OfficerPhotoKey\[\] = \["front", "rear"\]/);
  });
  it("no network, upload or storage in the check; the temp inference image is deleted", () => {
    const src = read("src/capture/vehicleCheck.ts") + read("src/capture/tfliteVehicleEngine.ts");
    expect(src).not.toMatch(/fetch\(|supabase|\.upload\(|AsyncStorage|recognize-plate|functions\.invoke/);
    expect(read("src/capture/tfliteVehicleEngine.ts")).toMatch(/file\.delete\(\)/);
    expect(read("src/capture/tfliteVehicleEngine.ts")).toMatch(/resize\(\{ width: MODEL_SIZE, height: MODEL_SIZE \}\)/);
  });
  it("the detector result never reaches the report or case: onCapturePhoto's signature is unchanged", () => {
    const cam = read("src/components/CameraCapture.tsx");
    expect(cam).toMatch(/onCapturePhoto: \(slotKey: string, uri: string, capturedAt: string\) => void \| Promise<void>;/);
    expect(cam).not.toMatch(/onCapturePhoto\([^)]*result/);
    for (const p of ["src/domain", "src/backend", "supabase/migrations"]) {
      const dir = path.join(ROOT, p);
      const files = fs.readdirSync(dir, { recursive: true }) as string[];
      for (const f of files.filter((x) => /\.(ts|sql)$/.test(String(x)))) expect(fs.readFileSync(path.join(dir, String(f)), "utf8")).not.toMatch(/vehicleCheck|VehicleCheck|vehicle_check/);
    }
  });
});
