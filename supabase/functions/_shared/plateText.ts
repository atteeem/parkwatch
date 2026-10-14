// Plate text and confidence rules shared by the recognize-plate Edge Function
// and the app. Pure TypeScript: no Deno, React Native or vendor imports.

/** Internal key: upper-case, separators removed (same rule as the app's normalizePlate). */
export function normalizePlateText(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[\s\-.·_]+/g, "");
}

/** Finnish standard plates: 1-3 letters + 1-3 digits (e.g. NNC-685, ZX-12). */
const FINNISH_STANDARD = /^([A-ZÅÄÖ]{1,3})(\d{1,3})$/;

export const looksFinnish = (normalized: string): boolean => FINNISH_STANDARD.test(normalized);

/**
 * Display form. Finnish-looking plates get the familiar hyphen (NNC-685).
 * Other plates keep the separators the provider returned, or are shown as
 * read - we never invent a foreign plate's spacing or reject it for not
 * matching the Finnish format.
 */
export function formatPlateDisplay(raw: string, country: string | null = null): string {
  const upper = raw.trim().toUpperCase().replace(/\s+/g, " ");
  const normalized = normalizePlateText(upper);
  const m = FINNISH_STANDARD.exec(normalized);
  if (m && (country === null || country === "FI")) return `${m[1]}-${m[2]}`;
  return /[\s\-.·_]/.test(upper) ? upper.replace(/[.·_]/g, "-") : normalized;
}

// ---------------------------------------------------------------------------
// Confidence. Provider scores are 0..1. One place for the thresholds.

/** Shown prominently as the recognised plate (still needs the citizen's confirmation). */
export const CONFIDENCE_HIGH = 0.85;
/** Shown, but the citizen is explicitly asked to check it. */
export const CONFIDENCE_MEDIUM = 0.6;
/** Below MEDIUM a read is treated as no reliable result. */
export type ConfidenceTier = "high" | "medium" | "low";

export function confidenceTier(confidence: number | null): ConfidenceTier {
  if (confidence === null || !Number.isFinite(confidence)) return "low";
  if (confidence >= CONFIDENCE_HIGH) return "high";
  if (confidence >= CONFIDENCE_MEDIUM) return "medium";
  return "low";
}

/** Two candidates within this margin are "ambiguous": the citizen picks. */
export const AMBIGUITY_MARGIN = 0.1;

// ---------------------------------------------------------------------------
// The ParkWatch response contract (server -> app). Vendor-neutral.

export type PlateCandidate = { plate: string; normalized: string; confidence: number };

export type PlateRecognitionResponse = {
  /** Best reading (display form), or null when there is no reliable result. */
  plate: string | null;
  normalized: string | null;
  confidence: number | null;
  /** ISO country code only when the provider reported it with confidence; never guessed. */
  country: string | null;
  /** Up to 3 distinct readings, best first (for ambiguity). */
  candidates: PlateCandidate[];
  provider: string;
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";

/** Strict parse of the contract (used by the app on every response). */
export function parseRecognitionResponse(json: unknown): PlateRecognitionResponse | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;
  const plate = j.plate === null ? null : isStr(j.plate) ? j.plate : undefined;
  const normalized = j.normalized === null ? null : isStr(j.normalized) ? j.normalized : undefined;
  const confidence = j.confidence === null ? null : isNum(j.confidence) ? j.confidence : undefined;
  const country = j.country === null ? null : isStr(j.country) ? j.country : undefined;
  if (plate === undefined || normalized === undefined || confidence === undefined || country === undefined) return null;
  if (!Array.isArray(j.candidates) || !isStr(j.provider)) return null;
  const candidates: PlateCandidate[] = [];
  for (const c of j.candidates) {
    if (!c || typeof c !== "object") return null;
    const x = c as Record<string, unknown>;
    if (!isStr(x.plate) || !isStr(x.normalized) || !isNum(x.confidence)) return null;
    candidates.push({ plate: x.plate, normalized: x.normalized, confidence: x.confidence });
  }
  if (plate !== null && (normalized === null || normalizePlateText(plate) !== normalized)) return null;
  return { plate, normalized, confidence, country, candidates: candidates.slice(0, 3), provider: j.provider };
}
