/**
 * @jest-environment node
 */
// OPT-IN real provider check (paid API: never part of `npm test`).
// Runs only with:
//   PARKWATCH_RUN_PLATE_PROVIDER=1 PLATE_RECOGNIZER_API_TOKEN=... PLATE_TEST_IMAGE=path/to/plate.jpg [PLATE_EXPECTED=NNC685] npm run test:plate-provider
// The token is read from the environment and never printed. The image is
// sent to the provider exactly as the Edge Function would send it.
import * as fs from "fs";
import { buildRecognitionResponse, createPlateRecognizerProvider } from "../plateRecognition.ts";

const RUN = process.env.PARKWATCH_RUN_PLATE_PROVIDER === "1";
const d = RUN ? describe : describe.skip;

d("Plate Recognizer (real API, opt-in)", () => {
  it("reads the test image and returns ParkWatch's contract", async () => {
    const token = process.env.PLATE_RECOGNIZER_API_TOKEN ?? "";
    const imagePath = process.env.PLATE_TEST_IMAGE ?? "";
    if (!token || !imagePath) throw new Error("Set PLATE_RECOGNIZER_API_TOKEN and PLATE_TEST_IMAGE");
    const base64 = fs.readFileSync(imagePath).toString("base64");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const outcome = await createPlateRecognizerProvider(token).recognize({ base64, mimeType: imagePath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg" }, controller.signal);
    clearTimeout(timer);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const response = buildRecognitionResponse(outcome, "platerecognizer");
    console.log(JSON.stringify({ plate: response.plate, confidence: response.confidence, country: response.country, candidates: response.candidates.length }));
    if (process.env.PLATE_EXPECTED) expect(response.normalized).toBe(process.env.PLATE_EXPECTED.toUpperCase().replace(/[^A-Z0-9ÅÄÖ]/g, ""));
  }, 30_000);
});

if (!RUN) {
  it("real provider check is opt-in (PARKWATCH_RUN_PLATE_PROVIDER=1)", () => {
    expect(RUN).toBe(false);
  });
}
