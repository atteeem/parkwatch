// T9.4 SPIKE - native pipeline for the post-capture vehicle check.
//
//   captured photo (multi-megapixel, untouched)
//   -> expo-image-manipulator: upright + resize to 320x320, saved as a SMALL temp JPEG
//   -> read its bytes, delete the temp file at once
//   -> jpeg-js decode (RGB, 320x320 only - never the original photo)
//   -> uint8 tensor -> react-native-fast-tflite (CPU) -> efficientdet_lite0 int8
//
// Nothing is uploaded, logged (beyond timings) or stored. Before any detector
// JavaScript is evaluated, nativeDetectorProbe checks (without throwing) that
// the Nitro + TFLite native code is really in this binary. If not (Expo Go, an
// older build, a broken native build) getVehicleEngine() returns null, the
// reason is kept for the dev diagnostic, and the camera works as before.

import type { OutputTensor, VehicleEngine } from "./vehicleCheck";
import { DetectorStatus, guardedRequire, probeNativeDetector } from "./nativeDetectorProbe";

export const MODEL_SIZE = 320;

type TfliteModelLike = {
  inputs: { dataType: string; shape: number[] }[];
  outputs: { name: string; dataType: string; shape: number[] }[];
  run(input: ArrayBuffer[]): Promise<ArrayBuffer[]>;
};

let enginePromise: Promise<VehicleEngine | null> | null = null;
export let lastModelLoadMs: number | undefined;
let status: DetectorStatus | null = null;

/** Why the detector is (un)available - for the dev diagnostic. null = not checked yet. */
export function getVehicleDetectorStatus(): DetectorStatus | null {
  return status;
}

/** One engine per app run; null when the native pieces are missing (never throws, never a red screen). */
export function getVehicleEngine(): Promise<VehicleEngine | null> {
  if (!enginePromise) {
    enginePromise = createEngine().catch((e) => {
      status = { ok: false, reason: "PROBE_ERROR", detail: String((e as Error)?.message ?? e).slice(0, 300) };
      return null;
    });
  }
  return enginePromise;
}

function currentStatus(): DetectorStatus {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { TurboModuleRegistry } = require("react-native") as typeof import("react-native");
  const Constants = (require("expo-constants") as { default: { executionEnvironment?: string } }).default;
  const jsNitroVersion = (require("react-native-nitro-modules/package.json") as { version: string }).version;
  /* eslint-enable @typescript-eslint/no-require-imports */
  return probeNativeDetector({
    executionEnvironment: Constants?.executionEnvironment,
    getTurboModule: (name) => TurboModuleRegistry.get(name) as never,
    getProxy: () => (globalThis as { NitroModulesProxy?: never }).NitroModulesProxy,
    jsNitroVersion,
  });
}

async function createEngine(): Promise<VehicleEngine | null> {
  status = currentStatus();
  if (!status.ok) {
    if (__DEV__) console.warn(`[vehicle-check] detector unavailable: ${status.reason}${status.detail ? ` - ${status.detail}` : ""}`);
    return null;
  }
  const errorUtils = (globalThis as { ErrorUtils?: Parameters<typeof guardedRequire>[1] }).ErrorUtils;
  // Native side confirmed; evaluate the JS packages without risking a fatal red screen.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const t = guardedRequire(() => require("react-native-fast-tflite") as { loadTensorflowModel: (src: number, delegates: string[]) => Promise<TfliteModelLike> }, errorUtils);
  if ("error" in t) {
    status = { ok: false, reason: "JS_LOAD_FAILED", detail: t.error };
    if (__DEV__) console.warn(`[vehicle-check] detector unavailable: JS_LOAD_FAILED - ${t.error}`);
    return null;
  }
  const tflite = t.value;
  /* eslint-disable @typescript-eslint/no-require-imports */
  const manipulatorMod = require("expo-image-manipulator") as typeof import("expo-image-manipulator");
  const fileMod = require("expo-file-system") as typeof import("expo-file-system");
  const jpeg = require("jpeg-js") as { decode: (data: Uint8Array, opts: Record<string, unknown>) => { width: number; height: number; data: Uint8Array } };
  /* eslint-enable @typescript-eslint/no-require-imports */

  let model: TfliteModelLike | null = null;
  let loading: Promise<TfliteModelLike> | null = null;
  const load = () => {
    if (!loading) {
      const t = Date.now();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      loading = tflite.loadTensorflowModel(require("../../assets/models/efficientdet_lite0_int8.tflite"), []).then((m) => {
        lastModelLoadMs = Date.now() - t;
        model = m;
        return m;
      });
    }
    return loading;
  };

  return {
    async prepare() {
      await load();
    },

    async resize(photoUri) {
      const { ImageManipulator, SaveFormat } = manipulatorMod;
      const ref = await ImageManipulator.manipulate(photoUri).resize({ width: MODEL_SIZE, height: MODEL_SIZE }).renderAsync();
      const small = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
      const file = new fileMod.File(small.uri);
      try {
        return await file.bytes();
      } finally {
        try {
          file.delete();
        } catch {
          // already gone: nothing to clean up
        }
      }
    },

    decode(bytes) {
      const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: false, maxResolutionInMP: 1, maxMemoryUsageInMB: 32 });
      return { rgb: img.data, width: img.width, height: img.height };
    },

    toTensor(rgb) {
      const input = model?.inputs[0];
      if (input?.dataType === "float32") {
        const f = new Float32Array(rgb.length);
        for (let i = 0; i < rgb.length; i++) f[i] = (rgb[i]! - 127.5) / 127.5;
        return f.buffer;
      }
      // uint8 (efficientdet_lite0 int8): the RGB bytes ARE the tensor
      return rgb.buffer.slice(rgb.byteOffset, rgb.byteOffset + rgb.byteLength) as ArrayBuffer;
    },

    async infer(tensor) {
      const m = model ?? (await load());
      const out = await m.run([tensor]);
      return out.map<OutputTensor>((buf, i) => ({
        name: m.outputs[i]?.name,
        shape: m.outputs[i]?.shape ?? [],
        data: m.outputs[i]?.dataType === "float32" ? new Float32Array(buf) : Float32Array.from(new Uint8Array(buf)),
      }));
    },
  };
}

/** Longest gap between animation frames while it runs (shows JS/UI blocking). */
export function startFrameMonitor(): () => number | undefined {
  if (typeof requestAnimationFrame !== "function") return () => undefined;
  let last = Date.now();
  let max = 0;
  let running = true;
  const tick = () => {
    if (!running) return;
    const n = Date.now();
    max = Math.max(max, n - last);
    last = n;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => {
    running = false;
    return Math.max(max, Date.now() - last);
  };
}
