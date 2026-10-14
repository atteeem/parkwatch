/**
 * @jest-environment node
 */
// recognize-plate Edge Function logic: auth, input validation, provider
// adapter parsing, ranking, error mapping, privacy of logs and responses.
// Uses fake providers only - no real recognition API is called.
import * as fs from "fs";
import * as path from "path";
import {
  buildRecognitionResponse,
  createMockPlateProvider,
  createPlateRecognizerProvider,
  MOCK_PLATE,
  parsePlateRecognizer,
  PLATE_RECOGNIZER_URL,
  PlateProvider,
  ProviderPlate,
} from "../plateRecognition.ts";
import { base64Bytes, createRateLimiter, handleRecognizePlate, HandlerDeps, MAX_IMAGE_BYTES } from "../recognizePlateHandler.ts";
import { confidenceTier, formatPlateDisplay, normalizePlateText, parseRecognitionResponse } from "../plateText.ts";

const JPEG = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const SECRET = "pr-secret-token-should-never-leak";

const request = (body: unknown, headers: Record<string, string> = {}, method = "POST") =>
  new Request("https://example.test/functions/v1/recognize-plate", {
    method,
    headers: { authorization: "Bearer user-token", "content-type": "application/json", ...headers },
    body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });

function deps(over: Partial<HandlerDeps> = {}) {
  const logs: unknown[] = [];
  const d: HandlerDeps = {
    verifyUser: async (auth) => (auth === "Bearer user-token" ? "user-1" : null),
    provider: createMockPlateProvider(),
    allow: () => true,
    log: (f) => logs.push(f),
    timeoutMs: 200,
    ...over,
  };
  return { d, logs };
}

const body = (b64 = JPEG, mimeType = "image/jpeg") => ({ image: b64, mimeType });
const plate = (text: string, confidence: number, box: ProviderPlate["box"] = null, region: ProviderPlate["region"] = null): ProviderPlate => ({ text, confidence, box, region, alternatives: [] });

describe("recognize-plate: authentication and input", () => {
  it("anonymous / invalid token -> 401, provider never called", async () => {
    const provider: PlateProvider = { name: "spy", recognize: jest.fn() };
    for (const headers of [{ authorization: "" }, { authorization: "Bearer someone-else" }, { authorization: "Basic abc" }]) {
      const res = await handleRecognizePlate(request(body(), headers), deps({ provider }).d);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "UNAUTHENTICATED" });
    }
    expect(provider.recognize).not.toHaveBeenCalled();
  });

  it("a valid signed-in request returns the ParkWatch contract (mock provider: NNC-685, FI)", async () => {
    const res = await handleRecognizePlate(request(body()), deps().d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      plate: "NNC-685",
      normalized: "NNC685",
      confidence: 0.94,
      country: "FI",
      candidates: [{ plate: "NNC-685", normalized: "NNC685", confidence: 0.94 }],
      provider: "mock",
    });
  });

  it("PNG accepted; other types, fake signatures, bad JSON and URL-style input are refused", async () => {
    expect((await handleRecognizePlate(request(body(PNG, "image/png")), deps().d)).status).toBe(200);
    expect((await handleRecognizePlate(request(body(JPEG, "image/gif")), deps().d)).status).toBe(415);
    expect((await handleRecognizePlate(request(body(PNG, "image/jpeg")), deps().d)).status).toBe(415); // declared JPEG, actually PNG
    expect((await handleRecognizePlate(request("{not json"), deps().d)).status).toBe(400);
    expect((await handleRecognizePlate(request({ image: "https://evil.test/a.jpg", mimeType: "image/jpeg" }), deps().d)).status).toBe(400);
    expect((await handleRecognizePlate(request({ upload_url: "https://evil.test/a.jpg", mimeType: "image/jpeg" }), deps().d)).status).toBe(400);
    expect((await handleRecognizePlate(request(body(), { "content-type": "text/plain" }), deps().d)).status).toBe(415);
    expect((await handleRecognizePlate(request(null, {}, "GET"), deps().d)).status).toBe(405);
  });

  it("oversized input -> 413 (declared length, body length or decoded image size)", async () => {
    const big = "/9j/" + "A".repeat(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 100);
    expect(base64Bytes(big)).toBeGreaterThan(MAX_IMAGE_BYTES);
    expect((await handleRecognizePlate(request(body(big)), deps().d)).status).toBe(413);
    expect((await handleRecognizePlate(request(body(), { "content-length": "99999999" }), deps().d)).status).toBe(413);
  });

  it("rate limit per user -> 429; the limiter forgets old requests", async () => {
    let t = 0;
    const allow = createRateLimiter(2, 1000, () => t);
    expect([allow("u"), allow("u"), allow("u")]).toEqual([true, true, false]);
    expect(allow("other")).toBe(true);
    t = 1500;
    expect(allow("u")).toBe(true);
    const res = await handleRecognizePlate(request(body()), deps({ allow: () => false }).d);
    expect(res.status).toBe(429);
  });

  it("no provider configured (no secret) -> 503 UNAVAILABLE", async () => {
    const res = await handleRecognizePlate(request(body()), deps({ provider: null }).d);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "UNAVAILABLE" });
  });
});

describe("recognize-plate: provider outcomes", () => {
  const withProvider = (p: Partial<PlateProvider> & Pick<PlateProvider, "recognize">) => deps({ provider: { name: "fake", ...p } }).d;

  it("timeout -> 504; rate limit -> 429; unavailable / malformed -> 503 / 502; a throwing provider -> 503", async () => {
    const slow = withProvider({ recognize: (_i, signal) => new Promise((resolve) => signal.addEventListener("abort", () => resolve({ ok: false, failure: "timeout" }))) });
    expect((await handleRecognizePlate(request(body()), slow)).status).toBe(504);
    expect((await handleRecognizePlate(request(body()), withProvider({ recognize: async () => ({ ok: false, failure: "rate_limited" }) }))).status).toBe(429);
    expect((await handleRecognizePlate(request(body()), withProvider({ recognize: async () => ({ ok: false, failure: "unavailable" }) }))).status).toBe(503);
    const bad = await handleRecognizePlate(request(body()), withProvider({ recognize: async () => ({ ok: false, failure: "bad_response" }) }));
    expect(bad.status).toBe(502);
    expect(await bad.json()).toEqual({ error: "UNAVAILABLE" }); // no raw provider error leaks
    expect((await handleRecognizePlate(request(body()), withProvider({ recognize: async () => { throw new Error(`boom ${SECRET}`); } }))).status).toBe(503);
  });

  it("no plate / low confidence -> plate null (the client offers retry / manual entry)", async () => {
    const none = await handleRecognizePlate(request(body()), withProvider({ recognize: async () => ({ ok: true, plates: [], imageWidth: 720, imageHeight: 160 }) }));
    expect(await none.json()).toMatchObject({ plate: null, normalized: null, confidence: null, candidates: [] });
    const low = await handleRecognizePlate(request(body()), withProvider({ recognize: async () => ({ ok: true, plates: [plate("abc123", 0.42)], imageWidth: 720, imageHeight: 160 }) }));
    expect(await low.json()).toMatchObject({ plate: null, confidence: 0.42, country: null, candidates: [] });
  });

  it("several plates: the one nearest the crop centre wins near-ties; close readings become candidates", () => {
    const centre = plate("nnc685", 0.88, { xmin: 160, ymin: 50, xmax: 560, ymax: 110 }, { code: "fi", confidence: 0.9 });
    const edge = plate("xyz999", 0.9, { xmin: 0, ymin: 0, xmax: 120, ymax: 30 }, { code: "fi", confidence: 0.9 });
    const r = buildRecognitionResponse({ ok: true, plates: [edge, centre], imageWidth: 720, imageHeight: 160 }, "fake");
    expect(r.plate).toBe("NNC-685");
    expect(r.candidates.map((c) => c.plate)).toEqual(["NNC-685", "XYZ-999"]);
  });

  it("country only when the provider is confident about it; never guessed", () => {
    const sure = buildRecognitionResponse({ ok: true, plates: [plate("nnc685", 0.9, null, { code: "fi", confidence: 0.8 })], imageWidth: null, imageHeight: null }, "x");
    expect(sure.country).toBe("FI");
    const unsure = buildRecognitionResponse({ ok: true, plates: [plate("nnc685", 0.9, null, { code: "fi", confidence: 0.3 })], imageWidth: null, imageHeight: null }, "x");
    expect(unsure.country).toBeNull();
    const none = buildRecognitionResponse({ ok: true, plates: [plate("nnc685", 0.9)], imageWidth: null, imageHeight: null }, "x");
    expect(none.country).toBeNull();
  });

  it("logs carry only outcome / status / duration; the secret, image and plate never appear in logs or responses", async () => {
    const fetchSpy = jest.fn(async () => new Response(JSON.stringify({ results: [{ plate: "nnc685", score: 0.95, region: { code: "fi", score: 0.9 }, candidates: [] }], image_width: 720, image_height: 160 }), { status: 201 }));
    const { d, logs } = deps({ provider: createPlateRecognizerProvider(SECRET, fetchSpy as unknown as typeof fetch) });
    const res = await handleRecognizePlate(request(body()), d);
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(JPEG.slice(0, 20));
    expect(logs).toHaveLength(1);
    expect(Object.keys(logs[0] as object).sort()).toEqual(["ms", "outcome", "status"]);
    const logged = JSON.stringify(logs);
    for (const s of [SECRET, JPEG.slice(0, 20), "NNC", "nnc", "user-token"]) expect(logged).not.toContain(s);
    const src = fs.readFileSync(path.join(__dirname, "../../recognize-plate/index.ts"), "utf8");
    // exactly one log statement, and it logs only the handler's outcome fields
    expect(src.match(/console\.\w+\(/g)).toEqual(["console.log("]);
    expect(src).toMatch(/console\.log\(JSON\.stringify\(\{ fn: "recognize-plate", \.\.\.f \}\)\)/);
    const handlerSrc = fs.readFileSync(path.join(__dirname, "../recognizePlateHandler.ts"), "utf8");
    expect(handlerSrc).not.toMatch(/console\./);
  });
});

describe("Plate Recognizer adapter", () => {
  it("sends the image as base64 with Finland-first regions, no paid extras, the token only in the header", async () => {
    const fetchSpy = jest.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ results: [], image_width: 1, image_height: 1 }), { status: 201 }));
    const p = createPlateRecognizerProvider(SECRET, fetchSpy as unknown as typeof fetch);
    await p.recognize({ base64: JPEG, mimeType: "image/jpeg" }, new AbortController().signal);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(PLATE_RECOGNIZER_URL);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Token ${SECRET}`);
    const sent = JSON.parse(init.body as string);
    expect(sent).toEqual({ upload: JPEG, regions: ["fi", "se", "ee", "no"], mmc: false, direction: false });
    expect(sent).not.toHaveProperty("upload_url");
  });

  it("maps 429 / 413 / 403 / 5xx / network / abort / malformed JSON", async () => {
    const call = (impl: () => Promise<Response>) => createPlateRecognizerProvider("t", impl as unknown as typeof fetch).recognize({ base64: JPEG, mimeType: "image/jpeg" }, new AbortController().signal);
    expect(await call(async () => new Response("{}", { status: 429 }))).toEqual({ ok: false, failure: "rate_limited" });
    expect(await call(async () => new Response("{}", { status: 413 }))).toEqual({ ok: false, failure: "too_large" });
    expect(await call(async () => new Response("{}", { status: 403 }))).toEqual({ ok: false, failure: "unavailable" });
    expect(await call(async () => new Response("{}", { status: 500 }))).toEqual({ ok: false, failure: "unavailable" });
    expect(await call(async () => { throw new TypeError("network"); })).toEqual({ ok: false, failure: "unavailable" });
    expect(await call(async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; })).toEqual({ ok: false, failure: "timeout" });
    expect(await call(async () => new Response("<html>", { status: 201 }))).toEqual({ ok: false, failure: "bad_response" });
    expect(await call(async () => new Response(JSON.stringify({ unexpected: true }), { status: 201 }))).toEqual({ ok: false, failure: "bad_response" });
  });

  it("parses the documented response (plate, score, box, region, candidates, image size); skips junk rows", () => {
    const parsed = parsePlateRecognizer({
      results: [
        { plate: "nnc685", score: 0.904, box: { xmin: 143, ymin: 481, xmax: 282, ymax: 575 }, region: { code: "fi", score: 0.747 }, candidates: [{ score: 0.904, plate: "nnc685" }, { score: 0.7, plate: "nmc685" }], dscore: 0.99 },
        { plate: 5, score: "x" },
      ],
      image_width: 1080,
      image_height: 720,
    })!;
    expect(parsed.imageWidth).toBe(1080);
    expect(parsed.plates).toEqual([
      { text: "nnc685", confidence: 0.904, box: { xmin: 143, ymin: 481, xmax: 282, ymax: 575 }, region: { code: "fi", confidence: 0.747 }, alternatives: [{ text: "nnc685", confidence: 0.904 }, { text: "nmc685", confidence: 0.7 }] },
    ]);
    expect(MOCK_PLATE.text).toBe("nnc685");
  });
});

describe("plate text: normalisation, display and confidence", () => {
  it("normalises like the app (upper-case, no separators)", () => {
    expect(normalizePlateText("NNC-685")).toBe("NNC685");
    expect(normalizePlateText("abc-123")).toBe("ABC123");
    expect(normalizePlateText(" ab 12 cd ")).toBe("AB12CD");
  });

  it("Finnish-looking plates get the hyphen; foreign formats stay usable and are never forced into Finnish shape", () => {
    expect(formatPlateDisplay("nnc685", "FI")).toBe("NNC-685");
    expect(formatPlateDisplay("nnc685")).toBe("NNC-685");
    expect(formatPlateDisplay("ABC 123", "SE")).toBe("ABC 123"); // provider spacing kept
    expect(formatPlateDisplay("abc123", "SE")).toBe("ABC123"); // foreign: no invented hyphen
    expect(formatPlateDisplay("b123abc", "DE")).toBe("B123ABC");
    expect(formatPlateDisplay("ab-12-cd")).toBe("AB-12-CD");
  });

  it("confidence tiers: high / medium / low", () => {
    expect(confidenceTier(0.94)).toBe("high");
    expect(confidenceTier(0.85)).toBe("high");
    expect(confidenceTier(0.7)).toBe("medium");
    expect(confidenceTier(0.42)).toBe("low");
    expect(confidenceTier(null)).toBe("low");
  });

  it("the app accepts only the exact contract", () => {
    const ok = { plate: "NNC-685", normalized: "NNC685", confidence: 0.9, country: "FI", candidates: [], provider: "x" };
    expect(parseRecognitionResponse(ok)).toEqual(ok);
    expect(parseRecognitionResponse({ ...ok, normalized: "XYZ" })).toBeNull();
    expect(parseRecognitionResponse({ ...ok, confidence: "0.9" })).toBeNull();
    expect(parseRecognitionResponse({ ...ok, candidates: [{ plate: 1 }] })).toBeNull();
    expect(parseRecognitionResponse(null)).toBeNull();
    expect(parseRecognitionResponse({ plate: null, normalized: null, confidence: null, country: null, candidates: [], provider: "x" })).not.toBeNull();
  });
});
