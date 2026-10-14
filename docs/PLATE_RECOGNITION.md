# Licence-plate recognition (Citizen plate scan)

Add Details → **Scan registration plate** reads the plate from a small crop of
the camera image. Recognition only **proposes** a plate: the citizen confirms
it ("Use NNC-685"), edits it, picks between close readings, or types it. The
confirmed text is stored in the report draft as a `CITIZEN_CONFIRMED` vehicle
(existing enum, no schema change). Manual entry is always available.

> Status: implemented and tested locally with a mock provider. The Edge
> Function is **not deployed** and the real provider is **not yet verified**
> until the secret below is configured and the function deployed.

## Architecture

```
app (signed-in citizen)
  -> takes one photo, crops it to the plate frame, resizes (<= 720 px wide JPEG)
  -> supabase.functions.invoke("recognize-plate", { image: base64, mimeType })
     Edge Function (supabase/functions/recognize-plate)
       - checks the caller's access token with Supabase Auth (401 otherwise)
       - per-user rate limit (6 / minute / instance), body <= 1.5 MB, image <= 1 MB,
         JPEG/PNG only (magic bytes checked), JSON only; no URLs accepted
       - calls the provider with an 8 s timeout (key from function secrets)
       - returns ParkWatch's own shape (below); provider errors become a few plain codes
  <- app shows the reading for confirmation / correction
```

Code:

| Part | File |
| --- | --- |
| Function entry (Deno) | `supabase/functions/recognize-plate/index.ts` |
| Request handling (auth, limits, errors) | `supabase/functions/_shared/recognizePlateHandler.ts` |
| Provider abstraction, Plate Recognizer adapter, mock | `supabase/functions/_shared/plateRecognition.ts` |
| Normalisation, display, confidence, response contract | `supabase/functions/_shared/plateText.ts` (also used by the app) |
| App client | `src/backend/plate/plateRecognitionClient.ts` |
| Crop geometry / capture | `src/presentation/plateCrop.ts`, `src/components/plate/capturePlateCrop.ts` |
| Scanner flow / UI | `src/presentation/plateScanFlow.ts`, `src/components/plate/PlateScanner.tsx` |

### Response

```json
{ "plate": "NNC-685", "normalized": "NNC685", "confidence": 0.94, "country": "FI",
  "candidates": [{ "plate": "NNC-685", "normalized": "NNC685", "confidence": 0.94 }],
  "provider": "platerecognizer" }
```

No reliable reading: `plate`, `normalized` and `country` are `null` (with the best
score, if any). Errors: `{ "error": "UNAUTHENTICATED" | "RATE_LIMITED" | "BAD_REQUEST" |
"UNSUPPORTED_MEDIA_TYPE" | "TOO_LARGE" | "UNAVAILABLE" | "TIMEOUT" }`.

### Confidence (one place: `plateText.ts`)

| Score | App |
| --- | --- |
| ≥ 0.85 | "Recognised plate" + "Use NNC-685" |
| 0.60 – 0.85 | "Check the plate matches the vehicle" + "Use …" |
| < 0.60 / none | "Couldn't read the plate" → Try again / Enter manually |

Two readings within 0.10 of each other (another plate in the crop, or an OCR
alternative such as NMC-685) → "Which plate is correct?" with up to 3 options.
Plates nearest the crop centre win near-ties. Country is shown only when the
provider reports it with ≥ 0.5 confidence; it is never guessed.

### Plate text

Normalised value = upper-case, separators removed (the app's existing rule).
Finnish-looking readings (1–3 letters + 1–3 digits) are shown as `NNC-685`;
other plates keep the provider's separators or are shown as read - foreign
formats are never rejected or forced into the Finnish pattern.

## Provider: Plate Recognizer (Snapshot Cloud API)

Chosen because it is a specialised ALPR API with Finland (`fi`) and the other
Nordic/Baltic regions supported, image upload (base64), per-plate confidence,
bounding boxes, region with confidence and alternative readings, and a simple
server-side token. Verified against the provider's published OpenAPI schema
(`https://api.platerecognizer.com/v1/api-reference/schema/`):
`POST https://api.platerecognizer.com/v1/plate-reader/`, header
`Authorization: Token <key>`, body `upload` (base64), `regions`, `mmc`,
`direction`; response `results[].plate|score|box|region|candidates`,
`image_width|image_height`; errors 403 (credits / token), 413, 429 (free trial
1 lookup/s, subscription 8/s). ParkWatch sends `regions = fi, se, ee, no` and
`mmc = false`, `direction = false` (paid vehicle extras are not used).

The provider sits behind `PlateProvider`; another vendor (or an on-premise
engine) can be added in `plateRecognition.ts` without touching the app.

**Privacy / production note.** Snapshot Cloud processes images on servers in the
USA, and no image-retention setting is documented. ParkWatch sends only a tight
plate crop (no car body, no people), stores nothing and logs nothing about the
image, but before production use confirm the provider's data processing terms
(DPA, retention, transfers) or consider their on-premise SDK.

## Configure and deploy (not done yet)

Needed: a Plate Recognizer account and its Snapshot Cloud **API token**
(app.platerecognizer.com → API token). Never paste it into chat, Git or the app.

1. Put it in the git-ignored `supabase/functions/.env` (copy `.env.example`):
   `PLATE_RECOGNITION_PROVIDER=platerecognizer` and `PLATE_RECOGNIZER_API_TOKEN=<token>`.
2. Set the secrets on the **development** project and deploy:

   ```bash
   npx supabase secrets set --env-file supabase/functions/.env --project-ref gmwssplqtjbrpvlvbjcs
   ```

   ```bash
   npx supabase functions deploy recognize-plate --project-ref gmwssplqtjbrpvlvbjcs
   ```

   (Dashboard alternative: Edge Functions → Secrets → add `PLATE_RECOGNIZER_API_TOKEN`.)
3. Without the secret the function answers `503 UNAVAILABLE` and the app falls
   back to manual entry.

`SUPABASE_URL` / `SUPABASE_ANON_KEY` are provided to functions by Supabase.

## Local development and tests

- `PLATE_RECOGNITION_PROVIDER=mock` makes the function return a fixed reading
  (NNC-685) for any image - local `supabase functions serve` only.
- `npm test` covers the function logic, the adapter (with fake HTTP responses),
  the client and the scanner UI. It never calls a real provider.
- Real provider check (paid, explicit opt-in):

  ```bash
  PARKWATCH_RUN_PLATE_PROVIDER=1 PLATE_RECOGNIZER_API_TOKEN=... PLATE_TEST_IMAGE=path/to/plate.jpg PLATE_EXPECTED=NNC685 npm run test:plate-provider
  ```

Local demo mode (no backend) has no recognition: the scanner is a framing aid
with manual entry.
