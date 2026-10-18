// T9.4 SPIKE - native pipeline for the post-capture vehicle check.
//
//   captured photo (multi-megapixel, untouched)
//   -> expo-image-manipulator: upright + resize to 320x320, saved as a SMALL temp JPEG
//   -> read its bytes, delete the temp file at once
//   -> jpeg-js decode (RGB, 320x320 only - never the original photo)
//   -> uint8 tensor -> react-native-fast-tflite (CPU) -> efficientdet_lite0 int8
//
// Nothing is uploaded, logged (beyond timings) or stored. Native modules are
// loaded lazily: on a build without react-native-fast-tflite (e.g. the
// current release-candidate dev build or Expo Go) getVehicleEngine() returns
// null and the camera works exactly as before.

import type { OutputTensor, VehicleEngine } from "./vehicleCheck";

export const MODEL_SIZE = 320;

type TfliteModelLike = {
  inputs: { dataType: string; shape: number[] }[];
  outputs: { name: string; dataType: string; shape: number[] }[];
  run(input: ArrayBuffer[]): Promise<ArrayBuffer[]>;
};

let enginePromise: Promise<VehicleEngine | null> | null = null;
export let lastModelLoadMs: number | undefined;

/** One engine per app run; null when the native pieces are missing. */
export function getVehicleEngine(): Promise<VehicleEngine | null> {
  if (!enginePromise) enginePromise = createEngine().catch(() => null);
  return enginePromise;
}

async function createEngine(): Promise<VehicleEngine | null> {
  let tflite: { loadTensorflowModel: (src: number, delegates: string[]) => Promise<TfliteModelLike> };
  let manipulatorMod: typeof import("expo-image-manipulator");
  let fileMod: typeof import("expo-file-system");
  let jpeg: { decode: (data: Uint8Array, opts: Record<string, unknown>) => { width: number; height: number; data: Uint8Array } };
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    tflite = require("react-native-fast-tflite");
    manipulatorMod = require("expo-image-manipulator");
    fileMod = require("expo-file-system");
    jpeg = require("jpeg-js");
    /* eslint-enable @typescript-eslint/no-require-imports */
  } catch {
    return null;
  }

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
