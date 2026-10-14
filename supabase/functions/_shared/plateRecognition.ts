// Licence-plate recognition: a small provider abstraction (server side only).
// The app never sees vendor formats or credentials - only the ParkWatch
// response contract from plateText.ts.

import {
  AMBIGUITY_MARGIN,
  CONFIDENCE_MEDIUM,
  formatPlateDisplay,
  normalizePlateText,
  PlateCandidate,
  PlateRecognitionResponse,
} from "./plateText.ts";

/** One plate a provider found, in vendor-neutral form. */
export type ProviderPlate = {
  text: string;
  confidence: number;
  /** Bounding box in image pixels, if the provider returns one. */
  box: { xmin: number; ymin: number; xmax: number; ymax: number } | null;
  /** Lower-case ISO country (e.g. "fi") with its own confidence, if reported. */
  region: { code: string; confidence: number } | null;
  /** Alternative readings of the same plate (best first). */
  alternatives: { text: string; confidence: number }[];
};

export type ProviderFailure = "timeout" | "rate_limited" | "unavailable" | "bad_response" | "too_large";

export type ProviderOutcome =
  | { ok: true; plates: ProviderPlate[]; imageWidth: number | null; imageHeight: number | null }
  | { ok: false; failure: ProviderFailure };

export type PlateImage = { base64: string; mimeType: "image/jpeg" | "image/png" };

export interface PlateProvider {
  readonly name: string;
  recognize(image: PlateImage, signal: AbortSignal): Promise<ProviderOutcome>;
}

/** Countries ParkWatch expects most (helps 0/O, 1/I decoding); foreign plates still read. */
export const PLATE_REGIONS = ["fi", "se", "ee", "no"];
/** A region is only reported back when the provider is at least this sure of it. */
export const REGION_MIN_CONFIDENCE = 0.5;

// ---------------------------------------------------------------------------
// Plate Recognizer Snapshot Cloud API
// POST https://api.platerecognizer.com/v1/plate-reader/  (Authorization: Token <key>)
// Body: upload (base64), regions, mmc=false, direction=false (paid extras not used).
// Response: results[] with plate, score, box{xmin,ymin,xmax,ymax}, region{code,score},
// candidates[]{plate,score}; image_width / image_height. Errors: 403 (credits/token),
// 413 (too large), 429 (rate limit).

export const PLATE_RECOGNIZER_URL = "https://api.platerecognizer.com/v1/plate-reader/";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Parse a Plate Recognizer response defensively. Unknown shapes -> null (bad_response). */
export function parsePlateRecognizer(json: unknown): { plates: ProviderPlate[]; imageWidth: number | null; imageHeight: number | null } | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;
  if (!Array.isArray(j.results)) return null;
  const plates: ProviderPlate[] = [];
  for (const r of j.results) {
    if (!r || typeof r !== "object") continue;
    const x = r as Record<string, unknown>;
    const text = typeof x.plate === "string" ? x.plate : null;
    const score = num(x.score);
    if (!text || score === null) continue;
    const b = x.box as Record<string, unknown> | undefined;
    const box = b && [b.xmin, b.ymin, b.xmax, b.ymax].every((v) => num(v) !== null) ? { xmin: b.xmin as number, ymin: b.ymin as number, xmax: b.xmax as number, ymax: b.ymax as number } : null;
    const rg = x.region as Record<string, unknown> | undefined;
    const region = rg && typeof rg.code === "string" && num(rg.score) !== null ? { code: rg.code, confidence: rg.score as number } : null;
    const alternatives = Array.isArray(x.candidates)
      ? (x.candidates as unknown[])
          .map((c) => c as Record<string, unknown>)
          .filter((c) => c && typeof c.plate === "string" && num(c.score) !== null)
          .map((c) => ({ text: c.plate as string, confidence: c.score as number }))
      : [];
    plates.push({ text, confidence: score, box, region, alternatives });
  }
  return { plates, imageWidth: num(j.image_width), imageHeight: num(j.image_height) };
}

export function createPlateRecognizerProvider(apiToken: string, fetchImpl: typeof fetch = fetch): PlateProvider {
  return {
    name: "platerecognizer",
    async recognize(image, signal) {
      let res: Response;
      try {
        res = await fetchImpl(PLATE_RECOGNIZER_URL, {
          method: "POST",
          headers: { Authorization: `Token ${apiToken}`, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ upload: image.base64, regions: PLATE_REGIONS, mmc: false, direction: false }),
          signal,
        });
      } catch (e) {
        return { ok: false, failure: (e as { name?: string })?.name === "AbortError" ? "timeout" : "unavailable" };
      }
      if (res.status === 429) return { ok: false, failure: "rate_limited" };
      if (res.status === 413) return { ok: false, failure: "too_large" };
      if (!res.ok) return { ok: false, failure: "unavailable" }; // 403 (credits / token), 5xx ...
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        return { ok: false, failure: "bad_response" };
      }
      const parsed = parsePlateRecognizer(json);
      return parsed ? { ok: true, ...parsed } : { ok: false, failure: "bad_response" };
    },
  };
}

/**
 * Deterministic provider for local development and automated tests only
 * (PLATE_RECOGNITION_PROVIDER=mock). It ignores the image.
 */
export function createMockPlateProvider(result: ProviderPlate[] = [MOCK_PLATE]): PlateProvider {
  return {
    name: "mock",
    async recognize() {
      return { ok: true, plates: result, imageWidth: 720, imageHeight: 160 };
    },
  };
}

export const MOCK_PLATE: ProviderPlate = {
  text: "nnc685",
  confidence: 0.94,
  box: { xmin: 60, ymin: 20, xmax: 660, ymax: 140 },
  region: { code: "fi", confidence: 0.91 },
  alternatives: [{ text: "nnc685", confidence: 0.94 }],
};

// ---------------------------------------------------------------------------
// Turning provider plates into the ParkWatch response

/**
 * Rank plates: the app crops to the plate frame, so the plate nearest the
 * crop centre is the intended one; confidence breaks near-ties. A plate far
 * from the centre loses up to half its weight.
 */
export function rankPlates(plates: ProviderPlate[], imageWidth: number | null, imageHeight: number | null): ProviderPlate[] {
  const weight = (p: ProviderPlate) => {
    if (!p.box || !imageWidth || !imageHeight) return p.confidence;
    const cx = (p.box.xmin + p.box.xmax) / 2 - imageWidth / 2;
    const cy = (p.box.ymin + p.box.ymax) / 2 - imageHeight / 2;
    const d = Math.min(1, Math.hypot(cx, cy) / Math.hypot(imageWidth / 2, imageHeight / 2));
    return p.confidence * (1 - 0.5 * d);
  };
  return [...plates].sort((a, b) => weight(b) - weight(a));
}

export function buildRecognitionResponse(
  outcome: Extract<ProviderOutcome, { ok: true }>,
  provider: string
): PlateRecognitionResponse {
  const ranked = rankPlates(outcome.plates, outcome.imageWidth, outcome.imageHeight);
  const best = ranked[0];
  const country = best?.region && best.region.confidence >= REGION_MIN_CONFIDENCE ? best.region.code.toUpperCase() : null;

  // Distinct readings: other plates in the crop, then the best plate's own alternatives.
  const seen = new Set<string>();
  const candidates: PlateCandidate[] = [];
  const add = (text: string, confidence: number, cc: string | null) => {
    const normalized = normalizePlateText(text);
    if (!normalized || seen.has(normalized) || confidence < CONFIDENCE_MEDIUM - AMBIGUITY_MARGIN) return;
    seen.add(normalized);
    candidates.push({ plate: formatPlateDisplay(text, cc), normalized, confidence });
  };
  if (best) add(best.text, best.confidence, country);
  for (const p of ranked.slice(1)) add(p.text, p.confidence, p.region && p.region.confidence >= REGION_MIN_CONFIDENCE ? p.region.code.toUpperCase() : null);
  if (best) for (const a of best.alternatives) add(a.text, a.confidence, country);

  if (!best || best.confidence < CONFIDENCE_MEDIUM) {
    return { plate: null, normalized: null, confidence: best ? best.confidence : null, country: null, candidates: [], provider };
  }
  const normalized = normalizePlateText(best.text);
  return {
    plate: formatPlateDisplay(best.text, country),
    normalized,
    confidence: best.confidence,
    country,
    candidates: candidates.slice(0, 3),
    provider,
  };
}
