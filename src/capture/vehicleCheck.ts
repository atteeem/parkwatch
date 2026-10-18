// T9.4 SPIKE - post-capture vehicle check (capture assistance only).
//
// After the user takes a vehicle photo, a small on-device model answers ONE
// question: "is a plausible vehicle in this photo?". It never decides a
// violation, evidence validity or a charge; the result is never stored, sent
// or attached to the report, and "Use photo anyway" always exists. Any error,
// missing native module or timeout = UNAVAILABLE = the normal camera flow.
//
// This file is pure (no native imports) so the rules are unit-tested; the
// native pipeline (resize -> decode -> tensor -> TFLite) is injected as an
// engine (src/capture/tfliteVehicleEngine.ts).

/** COCO class ids in efficientdet_lite0 (0-based, from the model's own labels.txt). */
export const VEHICLE_CLASSES: Readonly<Record<number, string>> = { 2: "car", 3: "motorcycle", 5: "bus", 7: "truck" };
/** Spike defaults, tuned on the phone. Low on purpose: a miss only costs one extra tap. */
export const VEHICLE_MIN_SCORE = 0.3;
/** Ignore tiny far-away vehicles (fraction of the frame). */
export const VEHICLE_MIN_AREA = 0.01;
/** Longer than this = give up and continue normally. */
export const CHECK_TIMEOUT_MS = 2500;

export type Detection = { classId: number; score: number; box: [number, number, number, number] }; // ymin, xmin, ymax, xmax (0..1)
export type BestGuess = { label: string; score: number };

export type CheckTimings = {
  resizeMs?: number;
  decodeMs?: number;
  tensorMs?: number;
  inferenceMs?: number;
  totalMs: number;
  /** Longest gap between animation frames while checking (UI jank indicator). */
  maxFrameGapMs?: number;
};

export type VehicleCheckResult =
  | { kind: "FOUND"; best: BestGuess; timings: CheckTimings }
  | { kind: "NOT_FOUND"; best?: BestGuess; timings: CheckTimings }
  | { kind: "UNAVAILABLE"; reason: "NO_ENGINE" | "TIMEOUT" | "ERROR"; timings?: CheckTimings };

/** Is a plausible vehicle present? (Not which one: no agreement with the chosen guide is required.) */
export function interpretDetections(detections: Detection[], minScore = VEHICLE_MIN_SCORE): { found: boolean; best?: BestGuess } {
  let best: BestGuess | undefined;
  let found = false;
  for (const d of detections) {
    const label = VEHICLE_CLASSES[Math.round(d.classId)];
    if (!label || !(d.score >= 0)) continue;
    if (!best || d.score > best.score) best = { label, score: d.score };
    const [y0, x0, y1, x1] = d.box;
    const area = Math.max(0, Math.min(1, y1) - Math.max(0, y0)) * Math.max(0, Math.min(1, x1) - Math.max(0, x0));
    if (d.score >= minScore && area >= VEHICLE_MIN_AREA) found = true;
  }
  return { found, ...(best ? { best } : {}) };
}

export type OutputTensor = { name?: string; shape: number[]; data: Float32Array };

/**
 * TFLite_Detection_PostProcess outputs -> detections. Identified by shape
 * (boxes [1,N,4], count [1]); classes vs scores by name, else by value range,
 * else the Model Maker order (location, category, score, count).
 */
export function parseDetectionOutputs(outputs: OutputTensor[]): Detection[] {
  const boxes = outputs.find((o) => o.shape.length === 3 && o.shape[2] === 4);
  const count = outputs.find((o) => o.shape.length <= 1 && o.data.length === 1);
  const pair = outputs.filter((o) => o !== boxes && o !== count && o.shape.length === 2);
  if (!boxes || pair.length !== 2) return [];
  let classes = pair.find((o) => /class|categor/i.test(o.name ?? ""));
  let scores = pair.find((o) => /score/i.test(o.name ?? ""));
  if (!classes || !scores || classes === scores) {
    const maxOf = (a: Float32Array) => a.reduce((m, v) => (v > m ? v : m), -Infinity);
    const [a, b] = pair as [OutputTensor, OutputTensor];
    if (maxOf(a.data) > 1 && maxOf(b.data) <= 1) [classes, scores] = [a, b];
    else if (maxOf(b.data) > 1 && maxOf(a.data) <= 1) [classes, scores] = [b, a];
    else [classes, scores] = [outputs[1], outputs[2]] as [OutputTensor, OutputTensor];
  }
  const n = Math.min(count ? Math.round(count.data[0] ?? 0) : scores.data.length, scores.data.length, classes.data.length, Math.floor(boxes.data.length / 4));
  const out: Detection[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      classId: classes.data[i] ?? -1,
      score: scores.data[i] ?? 0,
      box: [boxes.data[i * 4] ?? 0, boxes.data[i * 4 + 1] ?? 0, boxes.data[i * 4 + 2] ?? 0, boxes.data[i * 4 + 3] ?? 0],
    });
  }
  return out;
}

/** The native pipeline, step by step (each step is timed separately). */
export interface VehicleEngine {
  /** Load the model once (may be called early, e.g. when the camera opens). */
  prepare(): Promise<void>;
  /** Downscale the captured photo to the model size; returns the SMALL image's JPEG bytes. Never the original. */
  resize(photoUri: string): Promise<Uint8Array>;
  /** Decode the small JPEG to RGB (synchronous in the spike: jpeg-js). */
  decode(jpeg: Uint8Array): { rgb: Uint8Array; width: number; height: number };
  /** Model input tensor from RGB. */
  toTensor(rgb: Uint8Array): ArrayBuffer;
  infer(tensor: ArrayBuffer): Promise<OutputTensor[]>;
}

export type CheckDeps = {
  now?: () => number;
  /** Starts measuring frame gaps; the returned function stops and returns the longest gap (ms). */
  startFrameMonitor?: () => () => number | undefined;
  timeoutMs?: number;
  minScore?: number;
};

export async function checkVehiclePhoto(photoUri: string, engine: VehicleEngine | null, deps: CheckDeps = {}): Promise<VehicleCheckResult> {
  if (!engine) return { kind: "UNAVAILABLE", reason: "NO_ENGINE" };
  const now = deps.now ?? (() => Date.now());
  const t0 = now();
  const stopFrames = deps.startFrameMonitor?.();
  const timings: CheckTimings = { totalMs: 0 };
  const run = async (): Promise<VehicleCheckResult> => {
    await engine.prepare();
    let t = now();
    const jpeg = await engine.resize(photoUri);
    timings.resizeMs = now() - t;
    t = now();
    const { rgb } = engine.decode(jpeg);
    timings.decodeMs = now() - t;
    t = now();
    const tensor = engine.toTensor(rgb);
    timings.tensorMs = now() - t;
    t = now();
    const outputs = await engine.infer(tensor);
    timings.inferenceMs = now() - t;
    const { found, best } = interpretDetections(parseDetectionOutputs(outputs), deps.minScore);
    timings.totalMs = now() - t0;
    return found && best ? { kind: "FOUND", best, timings } : { kind: "NOT_FOUND", ...(best ? { best } : {}), timings };
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<VehicleCheckResult>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "UNAVAILABLE", reason: "TIMEOUT", timings: { ...timings, totalMs: now() - t0 } }), deps.timeoutMs ?? CHECK_TIMEOUT_MS);
  });
  try {
    const r = await Promise.race([run(), timeout]);
    const gap = stopFrames?.();
    if (gap !== undefined) (r.timings ?? timings).maxFrameGapMs = gap;
    return r;
  } catch {
    stopFrames?.();
    return { kind: "UNAVAILABLE", reason: "ERROR", timings: { ...timings, totalMs: now() - t0 } };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Dev-build diagnostics line (no image data). */
export function formatTimings(t: CheckTimings | undefined): string {
  if (!t) return "";
  const f = (v: number | undefined) => (v === undefined ? "-" : String(Math.round(v)));
  return `resize ${f(t.resizeMs)} · decode ${f(t.decodeMs)} · tensor ${f(t.tensorMs)} · infer ${f(t.inferenceMs)} · total ${f(t.totalMs)} ms${t.maxFrameGapMs !== undefined ? ` · max frame gap ${f(t.maxFrameGapMs)} ms` : ""}`;
}
