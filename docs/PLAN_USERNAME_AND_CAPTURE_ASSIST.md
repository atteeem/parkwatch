# Plan: editable username (A) and camera capture assistance (B)

Status: **plan only - nothing implemented, no dependency added, no migration applied.**
Branch `t9.3-release-candidate-hardening`. Written 2026-10-18.

---

## A. Username with a 30-day cooldown

### What exists today

* `profiles.display_name` is the only name field (text, max 80). It is the person's
  **real name**: sign-up asks "Name" / "Your name" (`autoComplete="name"`).
* Who sees it: the user on their own Profile/home; staff names inside their own
  organization in the console (`pw_console_member_name`, `admin_whoami`, officer lists).
* **Citizens are never shown by name to anyone else** in backend mode; the console and
  officer app use a pseudonymous reference. (The "Mika S." reporter name exists only in
  the local demo.)
* There is no username, no handle and no public identity field. Citizens can update
  `display_name` directly (column grant `update (display_name)`), with no cooldown.

So `display_name` is a private real-name field and must not get handle rules (spaces,
3-24 characters). The username is a **new, separate public handle**. It doesn't
conflict: the name is who you are (private), the username is what you go by (public).
Note that **today no screen would show a username to anyone else**. At first it appears
only on the user's own Profile; showing it to others (e.g. instead of the pseudonymous
reference) would be a separate product decision.

### Proposed migration `20261018000001_username.sql` (local file only until approved)

```sql
alter table public.profiles
  add column username text,              -- canonical lowercase, null until chosen
  add column username_changed_at timestamptz;
alter table public.profiles add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9_]{3,24}$');
create unique index profiles_username_key on public.profiles (username);   -- nulls allowed, case-insensitive by construction

create table public.reserved_usernames (name text primary key check (name ~ '^[a-z0-9_]{1,24}$'));
alter table public.reserved_usernames enable row level security;          -- no policies: not readable by clients
insert into public.reserved_usernames values ('admin'), ('administrator'), ('parkwatch'),
  ('support'), ('help'), ('officer'), ('supervisor'), ('staff'), ('moderator'), ('system'),
  ('root'), ('api'), ('police'), ('poliisi'), ('official'), ('security'), ('null'), ('undefined'), ...;

create function public.set_username(p_username text) returns jsonb
language plpgsql security definer set search_path = '' as $$ ... $$;
revoke all on function public.set_username(text) from public, anon;
grant execute on function public.set_username(text) to authenticated;
-- request_account_deletion re-created with one extra line: username = null
```

`set_username(p_username)` rules:

* The caller comes from `pw_require_user()`. There is **no user-id parameter**, so nobody
  can change another account's username.
* Normalization (same in app and server): trim, then lowercase. After that the name must
  match `^[a-z0-9_]{3,24}$`. Anything else gets `INVALID_INPUT` (spaces, `@`, accents, too short or too long).
* Reserved names are refused, as is anything starting with `parkwatch` or `admin`. There is
  no existing offensive-word system; the reserved table is the place for one, maintained by operators.
* Closed accounts get `FORBIDDEN`.
* `select ... for update` on the caller's own row serializes their own concurrent calls.
* Same as the current username: `{changed:false, username, next_change_at}`. Nothing
  changes and the cooldown is not reset.
* Cooldown: if `username_changed_at + interval '30 days' > now()`, the result is
  `{changed:false, reason:'COOLDOWN', next_change_at}` (returned, not raised, so the app
  can show the date). The **first** username also starts the cooldown, so set-then-change
  is still limited to once per 30 days.
* Taken: the update runs in a sub-block. `unique_violation` gives
  `{changed:false, reason:'TAKEN'}`. Two users claiming the same name at the same time
  are settled by the unique index: exactly one wins and the other gets TAKEN, never an
  error and never two owners.
* Success: set `username` and `username_changed_at = now()`, audit `profile` /
  `USERNAME_CHANGED` with **empty metadata** (no old or new name is kept as history), and
  return `{changed:true, username, next_change_at}`.
* Server time only. Device clocks are never trusted.

Columns are not client-writable: the only column grant is `update (display_name)`, so a
direct `update profiles set username = ...` from the app is denied.

Rollback file: drop the function, table, index, constraint and columns, and restore the
previous `request_account_deletion`.

### App

* Profile → "Username" row: `@name` or "Choose a username". Underneath: "You can change
  it again on 17 Nov 2026 (30 days)". An edit screen with live validation, the same
  normalizer as the server, and a clear message for taken / reserved / cooldown with the date.
* Backend mode only. The local demo shows the row as unavailable, like Password.
* `display_name` behaviour is unchanged. No default username is ever derived from the email.

### Tests

* **PGlite verifier (`verify-t94.mjs`):**
  * first set succeeds;
  * a taken name in different case is denied;
  * invalid names are denied (2 and 25 characters, spaces, `@`, `ä`, reserved);
  * a second change on day 29 is denied with `next_change_at`;
  * a change at exactly 30 days, and after, succeeds;
  * there is no target parameter, and a direct update is denied;
  * anonymous calls are denied;
  * concurrent claims by two sessions give one winner and TAKEN for the other;
  * closure clears the username;
  * the audit event has no name in it;
  * setting the same name again is a no-op.
* **Jest:** the normalizer and validator, Profile row copy and dates, the screen's
  error mapping, and the mock backend.
* **Rolled-back cloud QA script** (like T9.3), run after the migration is approved and applied.

---

## B. Camera capture assistance (on-device)

### 1. Current camera architecture

* `src/components/CameraCapture.tsx` (citizen Front/Side/Rear, officer 4 photos) and
  `src/components/plate/PlateScanner.tsx` use **expo-camera `CameraView`**:
  `takePictureAsync({quality: 0.6})`, torch, guide overlay (`CameraGuideOverlay`), level
  indicator from expo-sensors, slot progression.
* Plate recognition: on capture, a crop goes to the `recognize-plate` Edge Function, then
  Plate Recognizer, then the user confirms. One call per scan.
* **expo-camera gives no access to live frames** (no frame processors). Only still photos
  and its built-in barcode scanner. Live detection is impossible on expo-camera.
  Repeatedly taking hidden low-quality photos would be slow, noisy, heavy on the battery
  and is not production-appropriate. Rejected.

### 2. Recommended technology

* **react-native-vision-camera v5** (Margelo, MIT; Nitro Modules; New Architecture), with
  `react-native-vision-camera-worklets` and `react-native-worklets` for frame processors,
  and its GPU **Resizer** to feed models.
* **Vehicles:** `react-native-fast-tflite` (MIT; Nitro; Android GPU/NNAPI delegates,
  CoreML on iOS) running **EfficientDet-Lite0 int8** (Apache-2.0, COCO).
* **Plates:** ML Kit **Text Recognition v2** on-device (Latin) inside a small native frame
  plugin. "Plate detected" means plate-shaped text (e.g. `ABC-123`) inside the plate
  guide, seen steadily. No API calls; Plate Recognizer is still used only after capture.
* A `CaptureAssist` interface, with detectors `vehicle | plate | sign` that can each be
  unavailable, plus a pure, testable stability state machine. The camera stays usable
  when any detector is missing or fails.

This means **migrating both camera screens from expo-camera to VisionCamera**. That is
the biggest risk: photo quality and size, torch, permissions, orientation, the guides
and the level indicator must all be re-checked on a phone.

### 3-5. Compatibility

| | Status | Notes |
| --- | --- | --- |
| Expo SDK 57 | Expected yes in a development build, **needs a 1-day spike to confirm** | VisionCamera v5 is New-Architecture/Nitro and SDK 57 is New-Architecture only; not Expo Go (not needed: we use dev builds) |
| Android | Yes | GPU delegate needs a config-plugin entry for OpenCL/GLES; ML Kit text through Google Play services (unbundled) or bundled |
| iOS | Yes in principle | CoreML delegate; ML Kit iOS (arm64 devices). Blocked anyway until Apple Developer enrollment |

### 6-7. Models and size (estimates - to measure in the spike, per ABI)

| Part | Size |
| --- | --- |
| VisionCamera v5 + worklets + Nitro | ~1-3 MB |
| fast-tflite + TFLite runtime (+GPU delegate) | ~2-4 MB |
| EfficientDet-Lite0 int8 model | ~4.4 MB |
| ML Kit Text Recognition v2 | ~0 MB on Android (unbundled, Play services downloads the model) / ~4 MB bundled; several MB on iOS |
| **Total** | **~+8-15 MB per APK**; less per device with an Android App Bundle |

### 8-10. What the models can honestly detect

* **Vehicle: yes, with a generic pretrained model.** COCO classes car, truck, bus and
  motorcycle cover parked vehicles well in daylight. (ML Kit's own object detector is
  **not** suitable: its built-in categories are fashion/food/home goods/place/plant, with no vehicle.)
* **Plate: needs either a specialized model or the text approach.** COCO has no licence
  plate class. Recommended: on-device text recognition plus the plate pattern, which fits
  the high-contrast Finnish plates and needs no training. A trained plate detector is the
  later upgrade. Avoid Ultralytics YOLO models (AGPL-3.0) in this closed app.
* **Finnish parking signs: needs a custom model. Not in v1.** COCO only has "stop sign".
  There is no permissively licensed generic traffic-sign detector that knows Finnish signs
  (post-2020 sign reform), and the Mapillary sign dataset is CC BY-NC-SA (non-commercial).
  v1 keeps the sign guide and normal capture, and **never claims "sign detected"**. The
  interface has a `sign` slot for a future custom model trained on consented and licensed
  Finnish sign photos.

### 11. Performance (mid-range Android, estimates)

* EfficientDet-Lite0 at 320x320 int8: ~30-60 ms on CPU with XNNPACK, faster on GPU. Run at
  **4 Hz**, not camera FPS. About 15-25% of one core.
* Text recognition: ~100-250 ms. Run at **2 Hz**, only on the plate step, cropped to the guide.
* No inference in the background or when the camera is not focused. Pause while a photo
  is being taken.

### 12. Privacy

* Live frames stay in memory on the phone and are released after each inference. They are
  never stored, uploaded or logged; only results (box/label/score) reach JavaScript.
* Only the photo the user takes enters the existing evidence flow. Plate Recognizer is
  still called once per scan, after capture, never while the camera is open.
* The TFLite model runs fully offline with no third party. ML Kit runs on-device, but
  Google Play services may send ML Kit usage metrics. Check this and disclose it in the
  Privacy Policy draft, or pick a TFLite plate model to avoid Google entirely.
* Detection never decides a violation, a charge or whether evidence is sufficient. Results
  are never sent to the server or stored with a report.

### 13. Exact fallback UX

* A step opens: a small neutral pill above the shutter reads "Searching for vehicle…" (or
  "Looking for licence plate…"). The guide outline and level indicator stay as they are.
* Detected: the object is seen in **3 of the last 4** inferences with a score of at least
  0.5, and its box overlaps the guide by at least 40%. The pill turns green with "Vehicle
  detected ✓" and the shutter is enabled as normal.
* Lost: after a **1 s grace period** it goes back to "Searching…". No flicker, and nothing
  red or flashing.
* After **3 s** without a detection, a "Take photo anyway" button appears and stays for
  that step. It takes the photo exactly like the shutter.
* Detector unavailable, model fails to load, any error, or no result within 2 s: the
  **normal camera** shows (no pill, shutter enabled immediately). This is silent for the
  user and logged once without image data.
* Parking sign step (v1): normal camera, no detection pill.
* Screen readers: the pill is a polite live region, announced only when the state changes.
  "Take photo anyway" is a labelled button.

### Tests (with a deterministic fake detector)

* **Detection and capture:**
  * a detected vehicle enables the shutter;
  * with no vehicle, the guidance stays;
  * the override appears at 3 s and takes the photo;
  * flicker is smoothed (sequences 1,0,1,1 and dropouts shorter than 1 s);
  * plate detection works on plate-shaped text only.
* **Failure:** an unavailable or failing detector leaves the normal camera; there is no
  stuck state.
* **Privacy:**
  * no network calls while the camera is open (fetch spy);
  * no frame data is written or logged;
  * Plate Recognizer is called once per capture only.
* **Enforcement:** submitted report and case payloads are identical with and without
  detection, so detection never reaches enforcement.

### Proposed order (after approval)

1. **Spike (Android dev build):**
   * VisionCamera v5 with a plain capture screen at the same photo quality;
   * fast-tflite with EfficientDet-Lite0;
   * measure size and latency on the phone.

   Go/no-go here.
2. **Port `CameraCapture` and `PlateScanner`** to VisionCamera with no detection, and run
   the full camera regression on the phone.
3. **Add the stability state machine, vehicle detection and the UX**, plus tests.
4. **Add plate-presence detection** (text plus pattern), plus tests.
5. **Sign detection:** none (the interface is ready).

---

## B (revised 2026-10-18): post-capture subject validation on expo-camera

Atte decided: **no VisionCamera migration now.** The proven expo-camera flow stays, and
the photo the user just took is checked on the phone.

* **Technology:** `react-native-fast-tflite` (MIT, Nitro Modules). It runs a model on a
  plain input buffer, with no VisionCamera needed, plus `react-native-nitro-modules`.
  Image preparation:
  1. the existing `expo-image-manipulator` makes the image upright and resizes it to 320x320;
  2. `jpeg-js` (BSD-3, pure JS) decodes it to RGB bytes;
  3. `model.run([buffer])` runs the model.
* **Vehicle model:** EfficientDet-Lite0 int8 (COCO), 4.4 MB, 320x320. Google reports
  37 ms on a Pixel 4 CPU. Vehicle classes: car, truck, bus, motorcycle. The licence is
  Apache-2.0 per the MediaPipe/TF Hub model card, **to confirm from the model card**
  before adding the file.
* **Time per photo (mid-range Android, estimate):** resizing the full-resolution photo
  takes ~200-500 ms and dominates; decoding ~20-60 ms; inference ~40-100 ms. **Total
  ~0.3-0.7 s** of "Checking photo…". To measure on the test phone.
* **Native build:** yes, **one new Android development build** (fast-tflite and Nitro are
  native). Not Expo Go. iOS works in principle but is blocked by Apple Developer enrollment.
* **When nothing is found:** "We couldn't detect a vehicle in this photo." [Retake]
  [Use photo anyway]. If the model fails, can't load, or takes longer than 2 s, the photo
  is accepted silently. The result is never stored or sent.
* **Citizen plate scan:** already does this. Capture, then one Plate Recognizer call; on no
  plausible plate it shows "Couldn't read the plate" with [Try again] and [Enter
  manually]. The scan crop is not evidence, so "Use photo anyway" does not apply. No change
  is needed beyond optional copy ("Retake").
* **Officer licence-plate photo:** no on-device plate model exists in this stack
  (COCO has no plate class). Reusing `recognize-plate` would send officer evidence to the
  US provider (blocker #10, data processing agreement) and cost a call per case. **Defer.**
  The officer's manual "Confirm plate" check stays the only plate decision.
* **Parking sign:** deferred. It needs a custom model trained on licensed Finnish sign photos.
