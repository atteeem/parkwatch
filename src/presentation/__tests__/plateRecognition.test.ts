// Citizen plate recognition, client side: crop geometry, scanner flow,
// confidence handling, the function client's error mapping and privacy.
import * as fs from "fs";
import * as path from "path";
import { plateCropRect, PLATE_UPLOAD_WIDTH, uploadWidthFor } from "../plateCrop";
import { INITIAL_SCAN, SCAN_COPY, SCAN_FAILURE_COPY, scanReducer, stateForResponse } from "../plateScanFlow";
import { createPlateRecognizer, errorForStatus } from "../../backend/plate/plateRecognitionClient";
import type { PlateRecognitionResponse } from "../../../supabase/functions/_shared/plateText";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const resp = (over: Partial<PlateRecognitionResponse> = {}): PlateRecognitionResponse => ({
  plate: "NNC-685",
  normalized: "NNC685",
  confidence: 0.94,
  country: "FI",
  candidates: [{ plate: "NNC-685", normalized: "NNC685", confidence: 0.94 }],
  provider: "mock",
  ...over,
});

describe("plate crop", () => {
  const view = { width: 390, height: 844 };
  const frame = { x: 24, y: 203, width: 342, height: 72 };

  it("maps the on-screen frame into the (cover-scaled) photo, with a margin, inside the image", () => {
    const image = { width: 3024, height: 4032 }; // portrait photo, upright
    const c = plateCropRect(image, view, frame);
    const scale = Math.max(view.width / image.width, view.height / image.height);
    // centre of the crop ~ centre of the frame in photo pixels
    const offX = (image.width * scale - view.width) / 2;
    const offY = (image.height * scale - view.height) / 2;
    expect(c.originX + c.width / 2).toBeCloseTo((frame.x + frame.width / 2 + offX) / scale, -1);
    expect(c.originY + c.height / 2).toBeCloseTo((frame.y + frame.height / 2 + offY) / scale, -1);
    expect(c.width).toBeGreaterThan(frame.width / scale); // margin added
    expect(c.width).toBeLessThan(image.width); // never the whole image
    expect(c.width * c.height).toBeLessThan(image.width * image.height * 0.15);
  });

  it("orientation: the crop is computed in upright pixels (a landscape-shaped photo gives a different, still valid crop)", () => {
    const portrait = plateCropRect({ width: 3024, height: 4032 }, view, frame);
    const landscape = plateCropRect({ width: 4032, height: 3024 }, view, frame);
    expect(portrait).not.toEqual(landscape);
    for (const [c, img] of [[portrait, { width: 3024, height: 4032 }], [landscape, { width: 4032, height: 3024 }]] as const) {
      expect(c.originX).toBeGreaterThanOrEqual(0);
      expect(c.originY).toBeGreaterThanOrEqual(0);
      expect(c.originX + c.width).toBeLessThanOrEqual(img.width);
      expect(c.originY + c.height).toBeLessThanOrEqual(img.height);
    }
  });

  it("stays inside the image even for a frame at the screen edge", () => {
    const c = plateCropRect({ width: 1000, height: 2000 }, view, { x: -40, y: -40, width: 500, height: 120 });
    expect(c.originX).toBe(0);
    expect(c.originY).toBe(0);
    expect(c.originX + c.width).toBeLessThanOrEqual(1000);
  });

  it("resizes down to the upload width, never up", () => {
    expect(uploadWidthFor(2400)).toBe(PLATE_UPLOAD_WIDTH);
    expect(uploadWidthFor(500)).toBe(500);
    const src = read("src/components/plate/capturePlateCrop.ts");
    expect(src).toMatch(/\.crop\(crop\)/);
    expect(src).toMatch(/removeQuietly\(photoUri\);\s*removeQuietly\(cropUri\);/); // both temporary files deleted
  });
});

describe("scanner flow", () => {
  const reading = scanReducer(INITIAL_SCAN, { type: "SCAN" });

  it("Scan -> Reading -> recognised plate (high) to confirm", () => {
    expect(reading).toEqual({ step: "reading" });
    expect(scanReducer(reading, { type: "OUTCOME", outcome: { ok: true, value: resp() } })).toEqual({ step: "result", plate: "NNC-685", tier: "high" });
    expect(SCAN_COPY.reading).toBe("Reading plate…");
  });

  it("medium confidence asks the citizen to check; low confidence / no plate = no result", () => {
    expect(stateForResponse(resp({ confidence: 0.7, candidates: [{ plate: "NNC-685", normalized: "NNC685", confidence: 0.7 }] }))).toEqual({ step: "result", plate: "NNC-685", tier: "medium" });
    expect(stateForResponse(resp({ plate: null, normalized: null, confidence: 0.42, candidates: [] }))).toEqual({ step: "noResult" });
    expect(stateForResponse(resp({ plate: null, normalized: null, confidence: null, candidates: [] }))).toEqual({ step: "noResult" });
  });

  it("close readings -> the citizen picks (top 3), never the first blindly", () => {
    const s = stateForResponse(
      resp({
        confidence: 0.82,
        candidates: [
          { plate: "NNC-685", normalized: "NNC685", confidence: 0.82 },
          { plate: "NMC-685", normalized: "NMC685", confidence: 0.78 },
          { plate: "NNC-686", normalized: "NNC686", confidence: 0.4 },
        ],
      })
    );
    expect(s).toEqual({ step: "choose", options: [{ plate: "NNC-685", normalized: "NNC685", confidence: 0.82 }, { plate: "NMC-685", normalized: "NMC685", confidence: 0.78 }] });
    expect(SCAN_COPY.choose).toBe("Which plate is correct?");
  });

  it("failures map to plain messages; manual entry is always offered by the UI; retry returns to aiming", () => {
    const failed = scanReducer(reading, { type: "OUTCOME", outcome: { ok: false, error: "NETWORK" } });
    expect(failed).toEqual({ step: "failed", error: "NETWORK" });
    expect(SCAN_FAILURE_COPY.UNAVAILABLE).toMatchObject({ title: "Recognition service unavailable", body: "You can still enter the plate manually." });
    for (const c of Object.values(SCAN_FAILURE_COPY)) expect(`${c.title} ${c.body}`).not.toMatch(/\d\.\d|error code|provider/i);
    expect(scanReducer(failed, { type: "RETRY" })).toEqual(INITIAL_SCAN);
  });

  it("edit keeps the recognised text for correction; a late answer after the citizen moved on is ignored", () => {
    const edit = scanReducer({ step: "result", plate: "NNC-685", tier: "high" }, { type: "EDIT", text: "NNC-685" });
    expect(edit).toEqual({ step: "edit", text: "NNC-685" });
    expect(scanReducer(edit, { type: "OUTCOME", outcome: { ok: true, value: resp({ plate: "XXX-1", normalized: "XXX1" }) } })).toBe(edit);
    expect(scanReducer(reading, { type: "SCAN" })).toBe(reading); // double tap: one request
  });
});

describe("recognition client", () => {
  const client = (invoke: jest.Mock) => ({ functions: { invoke } }) as never;

  it("sends the crop to the recognize-plate function and validates the reply", async () => {
    const invoke = jest.fn(async () => ({ data: resp(), error: null }));
    const out = await createPlateRecognizer(client(invoke))({ base64: "/9j/abc", mimeType: "image/jpeg" });
    expect(invoke).toHaveBeenCalledWith("recognize-plate", { body: { image: "/9j/abc", mimeType: "image/jpeg" } });
    expect(out).toEqual({ ok: true, value: resp() });
    const bad = await createPlateRecognizer(client(jest.fn(async () => ({ data: { plate: 5 }, error: null }))))({ base64: "x", mimeType: "image/jpeg" });
    expect(bad).toEqual({ ok: false, error: "BAD_RESPONSE" });
  });

  it("maps network, 401, 429, 504 and other failures", async () => {
    const run = (error: unknown) => createPlateRecognizer(client(jest.fn(async () => ({ data: null, error }))))({ base64: "x", mimeType: "image/jpeg" });
    expect(await run({ name: "FunctionsFetchError" })).toEqual({ ok: false, error: "NETWORK" });
    expect(await run({ name: "FunctionsHttpError", context: { status: 401 } })).toEqual({ ok: false, error: "UNAUTHENTICATED" });
    expect(await run({ name: "FunctionsHttpError", context: { status: 429 } })).toEqual({ ok: false, error: "RATE_LIMITED" });
    expect(await run({ name: "FunctionsHttpError", context: { status: 504 } })).toEqual({ ok: false, error: "TIMEOUT" });
    expect(await run({ name: "FunctionsHttpError", context: { status: 502 } })).toEqual({ ok: false, error: "UNAVAILABLE" });
    expect(errorForStatus(undefined)).toBe("UNAVAILABLE");
    const thrown = await createPlateRecognizer(client(jest.fn(async () => { throw new Error("network down"); })))({ base64: "x", mimeType: "image/jpeg" });
    expect(thrown).toEqual({ ok: false, error: "NETWORK" });
  });

  it("no provider secret or vendor detail in the app; recognition only in backend mode", () => {
    const app = ["src/backend/plate/plateRecognitionClient.ts", "src/components/plate/PlateScanner.tsx", "src/components/plate/capturePlateCrop.ts", "src/context/AppContext.tsx"].map(read).join("\n");
    expect(app).not.toMatch(/api\.platerecognizer\.com|PLATE_RECOGNIZER_API_TOKEN|Token \$\{/);
    expect(read("src/context/AppContext.tsx")).toMatch(/plateRecognizer: null,/); // local demo: none
    expect(fs.existsSync(path.join(ROOT, ".env.example")) ? read(".env.example") : "").not.toMatch(/PLATE_RECOGNIZER_API_TOKEN=\S/);
  });

  it("privacy: the scan crop is not report evidence and nothing is persisted", () => {
    const ui = read("src/components/plate/PlateScanner.tsx") + read("src/components/plate/PlateEntryCard.tsx") + read("src/components/plate/capturePlateCrop.ts");
    expect(ui).not.toMatch(/capturePhoto|addAttachment|AsyncStorage|storage\.from|uploadEvidence/);
  });
});
