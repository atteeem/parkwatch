// T8.7: evidence gallery, camera guides, parking end-time wheel, officer
// continuous capture, officer evidence types, monthly statistics, Wallet
// naming and profile pictures.
import * as fs from "fs";
import * as path from "path";
import { citizenGalleryItems, clampIndex, galleryCounter, galleryPageLabel, indexFromOffset, OFFICER_EVIDENCE_CAPTION } from "../evidenceGallery";
import { CAMERA_GUIDE_HINT, CITIZEN_CAMERA_GUIDE, guideFrame, MAX_HEIGHT_SHARE, OFFICER_CAMERA_GUIDE } from "../cameraGuides";
import {
  ceilToWheelStep,
  clampEndTime,
  durationUntil,
  endTimeForPreset,
  endTimeOptions,
  formatClock,
  parkingQuote,
  wheelAccessibilityText,
  wheelIndexFor,
  WHEEL_MIN_MINUTES,
} from "../parkingViews";
import { activeOfficerSlot, afterOfficerSave, initialOfficerCapture, nextMissingOfficerSlot, OFFICER_CAPTURE_ORDER, officerCaptureComplete, selectOfficerSlot } from "../officerCapture";
import { localMonthlyStats, monthlyStatsFromServer, monthRange, weeklyBreakdown } from "../officerStats";
import { OFFICER_PHOTO_KEY_TO_TYPE } from "../viewModels";
import { isValidParkingDuration, MAX_PARKING_DURATION_MINUTES, OFFICER_EVIDENCE_TYPES, OfficerCase } from "../../domain";
import { migrateV4toV5, V4_OFFICER_EVIDENCE_RENAME } from "../../store/migrations";
import { avatarPath, AvatarRepository, removeAvatar, replaceAvatar } from "../../backend/storage/avatarStorage";
import { base64ToArrayBuffer } from "../../avatar/avatarImage";
import { ParkWatchState } from "../../store/state";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const MIN = 60_000;

// ---------------------------------------------------------------------------
describe("evidence gallery", () => {
  const evidence = [
    { id: "a1", type: "ATTACHMENT", uri: "file:///a1.jpg" },
    { id: "r", type: "REAR", uri: "file:///r.jpg" },
    { id: "f", type: "FRONT", uri: "file:///f.jpg" },
    { id: "a2", type: "ATTACHMENT", uri: "file:///a2.jpg" },
    { id: "s", type: "SIDE", uri: "file:///s.jpg" },
  ];

  it("orders Front, Side, Rear, then attachments (in their order), with captions", () => {
    const items = citizenGalleryItems(evidence);
    expect(items.map((i) => i.key)).toEqual(["f", "s", "r", "a1", "a2"]);
    expect(items.map((i) => i.caption)).toEqual(["Front", "Side", "Rear", "Attachment", "Attachment"]);
  });

  it("ignores unknown types and empty URIs", () => {
    expect(citizenGalleryItems([{ type: "VEHICLE_FRONT", uri: "x" }, { type: "FRONT", uri: "" }])).toEqual([]);
  });

  it("paging index, counter and label", () => {
    expect(indexFromOffset(0, 390, 5)).toBe(0);
    expect(indexFromOffset(390 * 2 + 100, 390, 5)).toBe(2);
    expect(indexFromOffset(390 * 9, 390, 5)).toBe(4);
    expect(indexFromOffset(500, 0, 5)).toBe(0);
    expect(clampIndex(-3, 5)).toBe(0);
    expect(clampIndex(3, 0)).toBe(0);
    expect(galleryCounter(0, 5)).toBe("1 / 5");
    expect(galleryCounter(7, 5)).toBe("5 / 5");
    const items = citizenGalleryItems(evidence);
    expect(galleryPageLabel(items[1], 1, 5)).toBe("Side photo, 2 of 5");
  });

  it("officer captions name the new evidence types", () => {
    expect(OFFICER_EVIDENCE_CAPTION).toEqual({ VEHICLE_FRONT: "Vehicle front", LICENSE_PLATE: "License plate", PARKING_SIGN: "Parking sign", VEHICLE_REAR: "Vehicle rear" });
  });

  it("one shared gallery: citizen Review and officer Report Details both use it", () => {
    expect(read("app/user/report/review.tsx")).toMatch(/from "..\/..\/..\/src\/components\/EvidenceGallery"/);
    expect(read("app/officer/report-details.tsx")).toMatch(/<EvidenceThumbnails items=\{detail\.evidence\}/);
    expect(fs.readdirSync(path.join(ROOT, "src/components")).filter((f) => /Gallery/i.test(f))).toEqual(["EvidenceGallery.tsx"]);
  });

  it("officer hero photo opens the SAME gallery at photo 1; one gallery instance on Report Details", () => {
    const src = read("app/officer/report-details.tsx");
    // Hero shows gallery item 1 and opens the gallery there.
    expect(src).toMatch(/<Pressable onPress=\{\(\) => setGalleryAt\(0\)\}[^>]*accessibilityRole="imagebutton"/);
    expect(src).toMatch(/<EvidencePhoto uri=\{detail\.evidence\[0\]!\.uri\} style=\{styles\.vehicleImg\}/);
    // Thumbnails open the same screen-owned gallery; it is rendered exactly once with all citizen evidence.
    expect(src).toMatch(/<EvidenceThumbnails items=\{detail\.evidence\}[^>]*onOpen=\{setGalleryAt\}/);
    expect(src.match(/<EvidenceGallery\b/g)).toHaveLength(1);
    expect(src).toMatch(/<EvidenceGallery items=\{detail\.evidence\} index=\{galleryAt\} onClose=\{\(\) => setGalleryAt\(null\)\}/);
    // A screen-owned gallery means the thumbnails do not render a second one.
    expect(read("src/components/EvidenceGallery.tsx")).toMatch(/\{onOpen \? null : <EvidenceGallery /);
  });

  it("officer gallery permissions are unchanged: photos render through EvidencePhoto (signed URLs), no new evidence storage policy", () => {
    const gallery = read("src/components/EvidenceGallery.tsx");
    expect(gallery).toMatch(/<EvidencePhoto uri=\{item\.uri\}/);
    expect(gallery).not.toMatch(/getPublicUrl|createSignedUrl|storage\.from/);
    expect(read("src/presentation/viewModels.ts")).toMatch(/evidence: citizenGalleryItems\(report\.evidence\)/);
    for (const f of fs.readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.startsWith("20261010"))) {
      // T8.7 migrations only. T9.0 adds org-scoped console read policies on purpose (tested in verify-t90).
      const sql = read(`supabase/migrations/${f}`);
      // No policy, helper or bucket setting for citizen/officer evidence is created or changed.
      const touches =
        /(create|alter|drop)\s+policy[^;]*(report-evidence|officer-evidence)|function\s+public\.(can_read_report_evidence_object|can_access_case|can_upload_officer_evidence|can_read_officer_evidence_object)|storage\.buckets[^;]*(report-evidence|officer-evidence)/i;
      expect([f, touches.test(sql)]).toEqual([f, false]);
    }
  });

  it("the gallery is accessible: close, previous/next buttons and a spoken page label", () => {
    const g = read("src/components/EvidenceGallery.tsx");
    expect(g).toMatch(/accessibilityLabel="Close photos"/);
    expect(g).toMatch(/accessibilityLabel="Previous photo"/);
    expect(g).toMatch(/accessibilityLabel="Next photo"/);
    expect(g).toMatch(/pagingEnabled/);
    expect(g).toMatch(/onRequestClose=\{onClose\}/);
  });
});

// ---------------------------------------------------------------------------
describe("camera framing guides", () => {
  it("citizen slots map to front / side / rear outlines", () => {
    expect(CITIZEN_CAMERA_GUIDE).toEqual({ FRONT: "vehicle-front", SIDE: "vehicle-side", REAR: "vehicle-rear" });
    expect(read("app/user/report/photos.tsx")).toMatch(/guide=\{activeSlot \? CITIZEN_CAMERA_GUIDE\[activeSlot\] : undefined\}/);
  });

  it("officer targets map to vehicle / plate / sign outlines", () => {
    expect(OFFICER_CAMERA_GUIDE).toEqual({ VEHICLE_FRONT: "vehicle-front", LICENSE_PLATE: "plate", PARKING_SIGN: "sign", VEHICLE_REAR: "vehicle-rear" });
  });

  it("frames fit any screen: inside the width, never taller than the allowed share", () => {
    for (const [w, h] of [[320, 568], [390, 844], [430, 932], [768, 1024], [844, 390]]) {
      for (const kind of Object.keys(CAMERA_GUIDE_HINT) as (keyof typeof CAMERA_GUIDE_HINT)[]) {
        const f = guideFrame(kind, w, h);
        expect(f.width).toBeLessThanOrEqual(w);
        expect(f.height).toBeLessThanOrEqual(Math.ceil(h * MAX_HEIGHT_SHARE));
        expect(f.width).toBeGreaterThan(0);
      }
    }
    const side = guideFrame("vehicle-side", 390, 844);
    const front = guideFrame("vehicle-front", 390, 844);
    expect(side.width / side.height).toBeGreaterThan(front.width / front.height); // side profile is longer
  });

  it("the guide is visual only: no detection claims, never takes touches, hidden from screen readers, drawn under the controls", () => {
    const overlay = read("src/components/CameraGuideOverlay.tsx");
    expect(overlay).toMatch(/pointerEvents="none"/);
    expect(overlay).toMatch(/importantForAccessibility="no-hide-descendants"/);
    const text = [...Object.values(CAMERA_GUIDE_HINT), overlay].join(" ");
    expect(text).not.toMatch(/\bAI\b|detect(ed|ing|ion)? (the )?(vehicle|car|plate)|automatic(ally)? (detect|recogn)/i);
    const cam = read("src/components/CameraCapture.tsx");
    expect(cam.indexOf("<CameraGuideOverlay")).toBeGreaterThan(cam.indexOf("<CameraView"));
    expect(cam.indexOf("<CameraGuideOverlay")).toBeLessThan(cam.indexOf("styles.instructionCard"));
  });
});

// ---------------------------------------------------------------------------
describe("parking end-time wheel", () => {
  const now = new Date(2026, 9, 7, 12, 32, 40);

  it("rows are every 5 minutes, starting at least 5 minutes ahead", () => {
    const opts = endTimeOptions(now);
    expect(formatClock(new Date(opts[0]).toISOString())).toBe("12:40");
    expect(opts[1] - opts[0]).toBe(5 * MIN);
    expect(opts[0] - now.getTime()).toBeGreaterThanOrEqual(WHEEL_MIN_MINUTES * MIN);
    expect(opts[opts.length - 1] - now.getTime()).toBeLessThanOrEqual(MAX_PARKING_DURATION_MINUTES * MIN);
  });

  it("end time -> duration: whole minutes, rounded up (never ends before the chosen row)", () => {
    const end = new Date(2026, 9, 7, 14, 35).getTime();
    const d = durationUntil(now, end);
    expect(d).toBe(123);
    expect(isValidParkingDuration(d)).toBe(true);
    expect(parkingQuote(d, now).endText).toBe("14:35");
    expect(parkingQuote(d, now).durationText).toBe("2 h 3 min");
  });

  it("duration bounds are the domain's: at least 1 minute, at most the maximum", () => {
    expect(durationUntil(now, now.getTime() - 10 * MIN)).toBe(1);
    expect(durationUntil(now, now.getTime() + 99 * 3600 * 1000)).toBe(MAX_PARKING_DURATION_MINUTES);
    for (const t of endTimeOptions(now)) expect(isValidParkingDuration(durationUntil(now, t))).toBe(true);
  });

  it("a chosen end time stays valid as time passes (clamped to the first available row)", () => {
    const opts = endTimeOptions(now);
    const later = new Date(now.getTime() + 20 * MIN);
    const laterOpts = endTimeOptions(later);
    expect(clampEndTime(laterOpts, opts[0])).toBe(laterOpts[0]);
    expect(clampEndTime([], opts[0])).toBeUndefined();
    expect(wheelIndexFor(opts, opts[3] + 60_000)).toBe(3);
    expect(wheelIndexFor(opts, 0)).toBe(0);
  });

  it("presets land on the 5-minute grid; the wheel has an accessible value", () => {
    expect(formatClock(new Date(endTimeForPreset(now, 60)).toISOString())).toBe("13:35");
    expect(ceilToWheelStep(new Date(2026, 9, 7, 12, 35).getTime())).toBe(new Date(2026, 9, 7, 12, 35).getTime());
    expect(wheelAccessibilityText(now, new Date(2026, 9, 7, 14, 35).getTime())).toBe("Ends at 14:35, 2 h 3 min");
  });

  it("the Start Parking screen uses the wheel as the custom control (no +/- stepper) and stays simulated", () => {
    const screen = read("app/user/parking/start.tsx");
    expect(screen).toMatch(/<EndTimeWheel /);
    expect(screen).not.toMatch(/Less time|More time|clampCustomDuration/);
    expect(screen).toMatch(/Simulated parking: no payment is taken/);
    const wheel = read("src/components/EndTimeWheel.tsx");
    expect(wheel).toMatch(/accessibilityRole="adjustable"/);
    expect(wheel).toMatch(/name: "increment"/);
    expect(wheel).toMatch(/snapToInterval=\{WHEEL_ROW_HEIGHT\}/);
  });
});

// ---------------------------------------------------------------------------
describe("officer continuous evidence capture", () => {
  const photos = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, `file:///${k}.jpg`]));

  it("order is Vehicle front -> License plate -> Parking sign -> Vehicle rear", () => {
    expect(OFFICER_CAPTURE_ORDER).toEqual(["front", "plate", "sign", "rear"]);
    expect(OFFICER_CAPTURE_ORDER.map((k) => OFFICER_PHOTO_KEY_TO_TYPE[k])).toEqual([...OFFICER_EVIDENCE_TYPES]);
  });

  it("a saved photo advances to the next missing target (camera stays open)", () => {
    let st = initialOfficerCapture();
    expect(activeOfficerSlot(st, photos([]))).toBe("front");
    st = afterOfficerSave(st, "front", { ok: true });
    expect(activeOfficerSlot(st, photos(["front"]))).toBe("plate");
    st = afterOfficerSave(st, "plate", { ok: true });
    st = afterOfficerSave(st, "sign", { ok: true });
    expect(activeOfficerSlot(st, photos(["front", "plate", "sign"]))).toBe("rear");
    st = afterOfficerSave(st, "rear", { ok: true });
    const all = photos(["front", "plate", "sign", "rear"]);
    expect(officerCaptureComplete(all)).toBe(true);
    expect(activeOfficerSlot(st, all)).toBeUndefined();
  });

  it("a failed upload stays on the same target with the error (does not advance)", () => {
    let st = afterOfficerSave(initialOfficerCapture(), "plate", { ok: false, message: "Upload failed." });
    expect(st).toEqual({ selected: "plate", error: "Upload failed." });
    // Even though "front" is still missing, the camera stays on the failed target.
    expect(activeOfficerSlot(st, photos([]))).toBe("plate");
    st = afterOfficerSave(st, "plate", { ok: true });
    expect(st.error).toBeNull();
    expect(activeOfficerSlot(st, photos(["plate"]))).toBe("front");
  });

  it("retake: tapping a captured target selects it; after saving, capture moves on to what is missing", () => {
    let st = selectOfficerSlot(initialOfficerCapture(), "front");
    const some = photos(["front", "plate"]);
    expect(activeOfficerSlot(st, some)).toBe("front");
    st = afterOfficerSave(st, "front", { ok: true });
    expect(activeOfficerSlot(st, some)).toBe("sign");
    expect(nextMissingOfficerSlot(photos(["front", "sign"]))).toBe("plate");
  });

  it("opening the camera from a slot starts there; unknown targets are ignored", () => {
    expect(initialOfficerCapture("sign").selected).toBe("sign");
    expect(initialOfficerCapture(["rear"]).selected).toBe("rear");
    expect(initialOfficerCapture("overview").selected).toBeUndefined();
  });

  it("the camera screen never navigates back after a save (only Done/close do)", () => {
    const screen = read("app/officer/violation-photo.tsx");
    const capture = screen.slice(screen.indexOf("onCapturePhoto="), screen.indexOf("onContinue="));
    expect(capture).not.toMatch(/goBack|router\./);
    expect(capture).toMatch(/afterOfficerSave/);
    expect(screen).toMatch(/onContinue=\{goBack\}/);
    expect(screen).toMatch(/onClose=\{goBack\}/);
    expect(read("app/officer/inspection.tsx")).toMatch(/Start evidence capture/);
  });
});

// ---------------------------------------------------------------------------
describe("officer evidence types (VEHICLE_FRONT / VEHICLE_REAR)", () => {
  it("domain, screens and keys use the new semantic types", () => {
    expect([...OFFICER_EVIDENCE_TYPES]).toEqual(["VEHICLE_FRONT", "LICENSE_PLATE", "PARKING_SIGN", "VEHICLE_REAR"]);
    expect(OFFICER_PHOTO_KEY_TO_TYPE).toEqual({ front: "VEHICLE_FRONT", plate: "LICENSE_PLATE", sign: "PARKING_SIGN", rear: "VEHICLE_REAR" });
  });

  it("no source file still uses the old labels (except the migrations that rename them)", () => {
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const f of fs.readdirSync(path.join(ROOT, d))) {
        const p = `${d}/${f}`;
        if (fs.statSync(path.join(ROOT, p)).isDirectory()) walk(p);
        else if (/\.(ts|tsx|mjs)$/.test(f) && /VEHICLE_OVERVIEW|VIOLATION_CONTEXT/.test(read(p))) hits.push(p);
      }
    };
    ["app", "src", "scripts"].forEach(walk);
    // Only the rename itself (local v4->v5 migration) and the tests that prove it mention the old labels.
    expect(hits.sort()).toEqual(["scripts/verify-t87.mjs", "src/backend/__tests__/migrations.db.test.ts", "src/presentation/__tests__/t87Features.test.ts", "src/store/migrations.ts"]);
  });

  it("saved local demo data is migrated v4 -> v5: photos keep their slots under the new names", () => {
    const ev = (type: string) => ({ id: `e-${type}`, source: "OFFICER", type, captureSource: "CAMERA", uri: `file:///${type}.jpg`, capturedAt: "2026-10-01T10:00:00.000Z" });
    const v4 = {
      inspections: {
        c1: { caseId: "c1", officerEvidence: { VEHICLE_OVERVIEW: ev("VEHICLE_OVERVIEW"), LICENSE_PLATE: ev("LICENSE_PLATE"), VIOLATION_CONTEXT: ev("VIOLATION_CONTEXT") } },
      },
    } as unknown as ParkWatchState;
    const v5 = migrateV4toV5(v4);
    const oe = (v5.inspections.c1 as unknown as { officerEvidence: Record<string, { type: string; uri: string }> }).officerEvidence;
    expect(Object.keys(oe).sort()).toEqual(["LICENSE_PLATE", "VEHICLE_FRONT", "VEHICLE_REAR"]);
    expect(oe.VEHICLE_FRONT).toMatchObject({ type: "VEHICLE_FRONT", uri: "file:///VEHICLE_OVERVIEW.jpg" });
    expect(oe.VEHICLE_REAR).toMatchObject({ type: "VEHICLE_REAR", uri: "file:///VIOLATION_CONTEXT.jpg" });
    expect(V4_OFFICER_EVIDENCE_RENAME).toEqual({ VEHICLE_OVERVIEW: "VEHICLE_FRONT", VIOLATION_CONTEXT: "VEHICLE_REAR" });
  });

  it("the server migration renames the enum values in place (rows stay valid)", () => {
    const sql = read("supabase/migrations/20261010000002_officer_evidence_front_rear.sql");
    expect(sql).toMatch(/alter type public\.officer_evidence_type rename value 'VEHICLE_OVERVIEW' to 'VEHICLE_FRONT';/);
    expect(sql).toMatch(/alter type public\.officer_evidence_type rename value 'VIOLATION_CONTEXT' to 'VEHICLE_REAR';/);
  });
});

// ---------------------------------------------------------------------------
describe("officer monthly statistics", () => {
  const range = monthRange(new Date(2026, 9, 15));
  const outcome = (code: string, officerId: string, at: Date) =>
    ({ id: `c-${code}-${at.getTime()}-${officerId}`, outcome: { code, officerId, decidedAt: at.toISOString() } }) as unknown as OfficerCase;

  it("the month range is the local calendar month", () => {
    expect(range.from).toEqual(new Date(2026, 9, 1));
    expect(range.to).toEqual(new Date(2026, 10, 1));
    expect(range.label).toBe("October 2026");
    expect(monthRange(new Date(2026, 0, 10), 1).label).toBe("December 2025");
  });

  it("LOCAL_DEMO counts only this officer's decisions inside the month, by outcome", () => {
    const cases = [
      outcome("CHARGE_ISSUED", "me", new Date(2026, 9, 2, 10)),
      outcome("CHARGE_ISSUED", "me", new Date(2026, 9, 2, 15)),
      outcome("REPORT_REJECTED", "me", new Date(2026, 9, 6, 9)),
      outcome("VEHICLE_MOVED", "me", new Date(2026, 9, 20, 9)),
      outcome("VALID_PERMIT", "me", new Date(2026, 9, 21, 9)),
      outcome("CHARGE_ISSUED", "someone-else", new Date(2026, 9, 3, 9)),
      outcome("CHARGE_ISSUED", "me", new Date(2026, 8, 30, 23)), // September
      { id: "open", outcome: undefined } as unknown as OfficerCase,
    ];
    const s = localMonthlyStats(cases, "me", range);
    expect({ completed: s.completed, issued: s.issued, rejected: s.rejected, noCharge: s.noCharge }).toEqual({ completed: 5, issued: 2, rejected: 1, noCharge: 2 });
    expect(s.days.map((d) => [d.day, d.completed])).toEqual([["2026-10-02", 2], ["2026-10-06", 1], ["2026-10-20", 1], ["2026-10-21", 1]]);
  });

  it("weekly breakdown covers every Monday-Sunday week of the month (zeros included)", () => {
    const s = localMonthlyStats([outcome("CHARGE_ISSUED", "me", new Date(2026, 9, 2, 10)), outcome("OTHER", "me", new Date(2026, 9, 31, 10))], "me", range);
    const weeks = weeklyBreakdown(s, range);
    expect(weeks.map((w) => w.label)).toEqual(["1–4 Oct", "5–11 Oct", "12–18 Oct", "19–25 Oct", "26–31 Oct"]);
    expect(weeks.map((w) => w.completed)).toEqual([1, 0, 0, 0, 1]);
    expect(weeks[4].noCharge).toBe(1);
  });

  it("server JSON is read defensively", () => {
    expect(
      monthlyStatsFromServer({ completed: "3", issued: 1, rejected: 1, no_charge: 1, days: [{ day: "2026-10-02", completed: 3, issued: 1, rejected: 1, no_charge: 1 }, { day: "bad" }] })
    ).toEqual({ completed: 3, issued: 1, rejected: 1, noCharge: 1, days: [{ day: "2026-10-02", completed: 3, issued: 1, rejected: 1, noCharge: 1 }] });
    expect(monthlyStatsFromServer({ completed: -4 })).toMatchObject({ completed: 0, days: [] });
    expect(monthlyStatsFromServer(null)).toBeNull();
  });

  it("BACKEND asks the server (never the loaded Cases pages); the page shows only recorded data", () => {
    const ctx = read("src/context/AppContext.tsx");
    expect(ctx).toMatch(/loadOfficerMonthlyStats: wrap\(\(st, range: \{ from: Date; to: Date \}\) => st\.loadOfficerMonthlyStats\(range, deviceTimeZone\(\)\)\)/);
    expect(read("src/backend/core/coreBackendStore.ts")).toMatch(/ops\.getOfficerMonthlyStats\(/);
    const page = read("app/officer/statistics.tsx");
    expect(page).not.toMatch(/response time:|km driven|€|score/i);
    expect(read("app/officer/profile.tsx")).toMatch(/title="Monthly Statistics"[^>]*onPress=\{\(\) => router\.push\("\/officer\/statistics"\)\}/);
  });
});

// ---------------------------------------------------------------------------
describe("Wallet naming", () => {
  it("the /user/earnings screen is titled Wallet; Earnings stays a section; nav unchanged", () => {
    const s = read("app/user/earnings.tsx");
    expect(s).toMatch(/>\s*Wallet\s*</);
    expect(s).not.toMatch(/style=\{styles\.headerTitle\}[^>]*>Earnings</);
    expect(s).toMatch(/styles\.chartLabel\}>Earnings</);
    const walletRow = read("app/user/profile.tsx")
      .split("\n")
      .find((l) => l.includes('title="Wallet"'));
    expect(walletRow).toContain('onPress={() => router.push("/user/earnings")}');
  });
});

// ---------------------------------------------------------------------------
describe("profile pictures", () => {
  function fakeRepo(over: Partial<AvatarRepository> = {}) {
    const calls: string[] = [];
    const repo: AvatarRepository = {
      getMyAvatarPath: async () => ({ ok: true, value: null }),
      upload: async (p) => (calls.push(`upload ${p}`), { ok: true, value: true }),
      setMyAvatar: async (p) => (calls.push(`set ${p}`), { ok: true, value: { previousPath: "u1/old.jpg" } }),
      removeObject: async (p) => (calls.push(`remove ${p}`), { ok: true, value: true }),
      signedUrl: async (p) => ({ ok: true, value: `https://signed.example/${p}?token=x` }),
      ...over,
    };
    return { repo, calls };
  }

  it("paths are inside the user's own folder and safe", () => {
    expect(avatarPath("u1", "abc-123")).toBe("u1/abc-123.jpg");
    expect(avatarPath("u1", "../../etc")).toBe("u1/______etc.jpg");
  });

  it("replace: upload new -> point profile at it -> delete the old object; returns a signed URL", async () => {
    const { repo, calls } = fakeRepo();
    const r = await replaceAvatar(repo, "u1", "new", new ArrayBuffer(3));
    expect(r).toEqual({ ok: true, value: { path: "u1/new.jpg", url: "https://signed.example/u1/new.jpg?token=x" } });
    expect(calls).toEqual(["upload u1/new.jpg", "set u1/new.jpg", "remove u1/old.jpg"]);
  });

  it("if the profile update fails, the uploaded object is removed and the old avatar stays", async () => {
    const { repo, calls } = fakeRepo({ setMyAvatar: async (p) => ({ ok: false, error: { code: "FORBIDDEN", message: String(p) } }) });
    const r = await replaceAvatar(repo, "u1", "new", new ArrayBuffer(3));
    expect(r.ok).toBe(false);
    expect(calls).toEqual(["upload u1/new.jpg", "remove u1/new.jpg"]);
  });

  it("a failed upload changes nothing", async () => {
    const { repo, calls } = fakeRepo({ upload: async () => ({ ok: false, error: { code: "UPLOAD_FAILED", message: "x" } }) });
    expect((await replaceAvatar(repo, "u1", "new", new ArrayBuffer(3))).ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("remove: clear the profile path, then delete the object", async () => {
    const { repo, calls } = fakeRepo();
    expect(await removeAvatar(repo)).toEqual({ ok: true, value: true });
    expect(calls).toEqual(["set null", "remove u1/old.jpg"]);
  });

  it("a failed avatar image re-signs the stored path (private bucket, signed URLs only)", () => {
    for (const f of ["app/user/profile.tsx", "app/user/earnings.tsx"]) expect(read(f)).toMatch(/<Avatar [^>]*onError=\{avatar\.onImageError\}/);
    expect(read("src/components/Avatar.tsx")).toMatch(/onError=\{onError \? \(\) => onError\(uri\)/);
    const ctx = read("src/auth/AvatarContext.tsx");
    expect(ctx).toMatch(/new SignedAvatarUrl\(/);
    expect(ctx).toMatch(/signed\?\.set\(r\.value\.path, r\.value\.url\)/);
    expect(read("src/backend/storage/avatarStorage.ts")).not.toMatch(/getPublicUrl/);
  });

  it("upload bytes are decoded from the shrunken JPEG's base64", () => {
    const bytes = new Uint8Array(base64ToArrayBuffer(Buffer.from("ParkWatch!").toString("base64")));
    expect(Buffer.from(bytes).toString()).toBe("ParkWatch!");
  });

  it("security: private bucket, path-only column, no image data in the profile, uploads never overwrite", () => {
    const sql = read("supabase/migrations/20261010000004_profile_avatars.sql");
    expect(sql).toMatch(/values \('profile-avatars', 'profile-avatars', false/);
    expect(sql).not.toMatch(/grant update \(.*avatar_storage_path/);
    expect(sql.replace(/--.*$/gm, "")).not.toMatch(/bytea|base64/i);
    expect(read("src/backend/storage/avatarStorage.ts")).toMatch(/upsert: false/);
    const pick = read("src/avatar/avatarImage.ts");
    expect(pick).toMatch(/aspect: \[1, 1\]/);
    expect(pick).toMatch(/resize\(\{ width: AVATAR_SIZE \}\)/);
    expect(read("src/auth/AvatarContext.tsx")).not.toMatch(/user_metadata|updateUser/);
  });

  it("LOCAL_DEMO keeps the picture on the phone; BACKEND loads it through a signed URL", () => {
    const ctx = read("src/auth/AvatarContext.tsx");
    expect(ctx).toMatch(/storage\.setItem\(localAvatarKey\(DEV_CITIZEN_ID\)/);
    expect(ctx).toMatch(/sign: \(p\) => repo\.signedUrl\(p\)/);
    expect(ctx).toMatch(/await signed\.set\(p\.value\)/);
    expect(read("app/user/profile.tsx")).toMatch(/<AvatarEditSheet/);
    const sheet = read("src/components/AvatarEditSheet.tsx");
    for (const label of ["Choose from library", "Take photo", "Remove photo"]) expect(sheet).toContain(label);
  });
});
