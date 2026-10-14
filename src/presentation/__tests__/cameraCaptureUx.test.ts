// Camera capture UX: vehicle-type guide geometry, guide fit, phone-level
// guidance, plate entry and truthfulness (pure logic + source checks).
import * as fs from "fs";
import * as path from "path";
import {
  END,
  endHeightRatio,
  roofLengthShare,
  SIDE,
  sideDrawing,
  sideHeightRatio,
  VEHICLE_GUIDE_PROFILES,
  VEHICLE_TYPE_LABEL,
  vehicleDrawing,
  VehicleGuideProfile,
} from "../vehicleGuideGeometry";
import { CameraGuideKind, guideFrame, guideFrameInArea, guideIsCompact, GUIDE_RESERVED_ABOVE, GUIDE_RESERVED_BELOW, GUIDE_RESERVED_BELOW_COMPACT, GUIDE_VIEW } from "../cameraGuides";
import { INITIAL_LEVEL, LEVEL_ENTER_DEG, LEVEL_EXIT_DEG, LEVEL_MESSAGE, levelReducer, LevelState, tiltFromGravity, UPRIGHT_EXIT_DEG } from "../deviceLevel";
import { PLATE_ASPECT, plateFieldValue, sanitizePlateInput } from "../plateEntry";
import { draftReducer, newDraftState } from "../reportDraft";
import { MVP_MOCK_DETECTED_VEHICLE } from "../../domain";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const ALL: VehicleGuideProfile[] = ["GENERIC", ...VEHICLE_GUIDE_PROFILES];

describe("vehicle-type guide geometry", () => {
  it("six body types plus Not sure, each with front / side / rear", () => {
    expect(VEHICLE_GUIDE_PROFILES).toEqual(["SEDAN", "SUV", "HATCHBACK", "PICKUP", "SPORT", "UTILITY"]);
    expect(VEHICLE_TYPE_LABEL.GENERIC).toBe("Not sure");
    for (const p of ALL) {
      for (const v of ["FRONT", "SIDE", "REAR"] as const) {
        const d = vehicleDrawing(p, v);
        expect(d.outline.startsWith("M")).toBe(true);
        expect(d.outline.trim().endsWith("Z")).toBe(true);
        expect(`${d.outline} ${d.details.join(" ")}`).not.toMatch(/NaN|undefined|Infinity/);
        expect(d.details.length).toBeGreaterThan(2);
        expect(d.details.length).toBeLessThan(12); // recognisable, not illustration art
      }
      expect(vehicleDrawing(p, "SIDE").wheels).toHaveLength(2);
    }
  });

  it("every type's silhouettes are distinct, and front differs from rear", () => {
    for (const v of ["FRONT", "SIDE", "REAR"] as const) {
      const outlines = VEHICLE_GUIDE_PROFILES.map((p) => vehicleDrawing(p, v).outline + vehicleDrawing(p, v).details.join(""));
      expect(new Set(outlines).size).toBe(VEHICLE_GUIDE_PROFILES.length);
    }
    for (const p of ALL) expect(vehicleDrawing(p, "FRONT").details.join("")).not.toBe(vehicleDrawing(p, "REAR").details.join(""));
  });

  it("pickup has an open bed (a long flat rail behind the cab); a sedan has a boot", () => {
    expect(SIDE.PICKUP.rearStyle).toBe("bed");
    expect(SIDE.SEDAN.rearStyle).toBe("notch");
    const bedLength = (SIDE.PICKUP.rear - SIDE.PICKUP.roofRear) / (SIDE.PICKUP.rear - SIDE.PICKUP.front);
    expect(bedLength).toBeGreaterThan(0.4);
    expect(sideDrawing("PICKUP").details.length).toBeGreaterThan(sideDrawing("SEDAN").details.length); // bed rail line
    expect(END.PICKUP.tailgate).toBe(true);
  });

  it("SUV is taller than a sedan; sport is the lowest; the van/MPV is the boxiest", () => {
    expect(sideHeightRatio("SUV")).toBeGreaterThan(sideHeightRatio("SEDAN") * 1.15);
    expect(endHeightRatio("SUV")).toBeGreaterThan(endHeightRatio("SEDAN"));
    for (const p of ALL.filter((x) => x !== "SPORT")) {
      expect(sideHeightRatio("SPORT")).toBeLessThan(sideHeightRatio(p));
      expect(endHeightRatio("SPORT")).toBeLessThan(endHeightRatio(p));
    }
    for (const p of ALL.filter((x) => x !== "UTILITY")) expect(roofLengthShare("UTILITY")).toBeGreaterThan(roofLengthShare(p));
    expect(SIDE.UTILITY.rearStyle).toBe("box");
    expect(SIDE.SUV.wheelR).toBeGreaterThan(SIDE.SEDAN.wheelR); // larger wheels/arches
    expect(SIDE.HATCHBACK.rear - SIDE.HATCHBACK.front).toBeLessThan(SIDE.SEDAN.rear - SIDE.SEDAN.front); // shorter overhangs
  });

  it("the guide fills the free camera area (much larger than before) without entering the reserved space", () => {
    for (const [w, area] of [[390, 420], [375, 380], [320, 240]] as const) {
      for (const kind of ["vehicle-front", "vehicle-side", "vehicle-rear", "plate", "sign"] as CameraGuideKind[]) {
        const f = guideFrameInArea(kind, w, area);
        expect(f.width).toBeLessThanOrEqual(w);
        const below = guideIsCompact(area) ? GUIDE_RESERVED_BELOW_COMPACT : GUIDE_RESERVED_BELOW;
        expect(f.height).toBeLessThanOrEqual(area - below - GUIDE_RESERVED_ABOVE + 1);
        expect(f.height).toBeGreaterThan(0);
      }
    }
    const before = guideFrame("vehicle-front", 390, 844);
    const now = guideFrameInArea("vehicle-front", 390, 420);
    expect(now.width * now.height).toBeGreaterThan(before.width * before.height);
    // short phones: the hint is dropped (it is in the instruction card) so the guide stays usable
    expect(guideIsCompact(240)).toBe(true);
    expect(guideIsCompact(420)).toBe(false);
    expect(guideFrameInArea("vehicle-front", 320, 240).height).toBeGreaterThan(150);
    expect(GUIDE_VIEW).toEqual({ "vehicle-front": "FRONT", "vehicle-side": "SIDE", "vehicle-rear": "REAR" });
  });
});

describe("phone level guidance", () => {
  const upright = (rollDeg: number, leanDeg = 0) => {
    const r = (rollDeg * Math.PI) / 180;
    const l = (leanDeg * Math.PI) / 180;
    return { x: Math.sin(r) * Math.cos(l), y: -Math.cos(r) * Math.cos(l), z: -Math.sin(l) };
  };
  const feed = (samples: { x: number; y: number; z: number }[], from: LevelState = INITIAL_LEVEL) => samples.reduce((s, g) => levelReducer(s, g), from);

  it("upright and level -> level; tilted beyond the tolerance -> tilted", () => {
    expect(feed([upright(1)]).status).toBe("level");
    expect(feed([upright(12)]).status).toBe("tilted");
    expect(feed([upright(-12)]).status).toBe("tilted");
    expect(LEVEL_MESSAGE.tilted).toBe("Level your phone");
  });

  it("hysteresis: between the two thresholds the previous state is kept (no flicker)", () => {
    const mid = (LEVEL_ENTER_DEG + LEVEL_EXIT_DEG) / 2;
    const level = feed([upright(0)]);
    expect(feed(Array(20).fill(upright(mid)), level).status).toBe("level");
    const tilted = feed([upright(15)]);
    expect(feed(Array(20).fill(upright(mid)), tilted).status).toBe("tilted");
    expect(feed(Array(30).fill(upright(1)), tilted).status).toBe("level");
  });

  it("smoothing: one noisy sample does not flip the state", () => {
    const level = feed(Array(10).fill(upright(0)));
    expect(levelReducer(level, upright(20)).status).toBe("level");
  });

  it("phone tipped far back / forward -> hold upright", () => {
    expect(feed([upright(0, UPRIGHT_EXIT_DEG + 10)]).status).toBe("notUpright");
    expect(LEVEL_MESSAGE.notUpright).toBe("Hold phone upright");
    expect(feed(Array(40).fill(upright(0, 5)), feed([upright(0, 60)])).status).toBe("level");
  });

  it("shakes (not ~1 g) are ignored; unchanged readings return the same state (no re-render)", () => {
    expect(tiltFromGravity({ x: 0, y: -2.5, z: 0 })).toBeNull();
    expect(feed([{ x: 0, y: 0, z: 0 }])).toBe(INITIAL_LEVEL);
    const s = feed(Array(30).fill(upright(0)));
    expect(levelReducer(s, upright(0))).toBe(s);
  });

  it("the platform axis sign only flips the horizon direction, not the status", () => {
    expect(tiltFromGravity(upright(10), 1)!.roll).toBeCloseTo(10, 0);
    expect(tiltFromGravity(upright(10), -1)!.roll).toBeCloseTo(-10, 0);
    expect(levelReducer(INITIAL_LEVEL, upright(10), -1).status).toBe("tilted");
  });

  it("guidance only: never stored or sent, never gates the shutter", () => {
    const sensorCode = read("src/sensors/useDeviceLevel.ts") + read("src/presentation/deviceLevel.ts");
    expect(sensorCode).not.toMatch(/AsyncStorage|fetch\(|supabase|storage|console\.log/i);
    expect(sensorCode).toMatch(/sub\?\.remove\(\)/);
    const camera = read("src/components/CameraCapture.tsx");
    expect(camera).not.toMatch(/level|Level/);
  });
});

describe("plate entry", () => {
  it("sanitises typed plates (upper-case, plate characters only, max length)", () => {
    expect(sanitizePlateInput("abc-123")).toBe("ABC-123");
    expect(sanitizePlateInput("  zä!x 9  ")).toBe("ZÄX 9 ");
    expect(sanitizePlateInput("ABCDEFGHIJKLMN")).toHaveLength(10);
    expect(PLATE_ASPECT).toBeCloseTo(4.73, 1);
  });

  it("a typed plate becomes the citizen-confirmed vehicle; clearing restores the default", () => {
    let s = newDraftState("d1");
    expect(plateFieldValue(s.draft)).toBe(""); // the default vehicle is never shown as if typed
    s = draftReducer(s, { type: "SET_PLATE", plate: "abc-123" });
    expect(s.draft.vehicle).toEqual({ plate: { raw: "ABC-123", normalized: "ABC123", country: "FI" }, source: "CITIZEN_CONFIRMED" });
    expect(plateFieldValue(s.draft)).toBe("ABC-123");
    s = draftReducer(s, { type: "SET_PLATE", plate: "  " });
    expect(s.draft.vehicle).toEqual({ ...MVP_MOCK_DETECTED_VEHICLE });
  });

  it("the vehicle type is draft UI context only; changing it keeps the photos", () => {
    let s = newDraftState("d2");
    s = draftReducer(s, { type: "CAPTURE_PHOTO", slot: "FRONT", uri: "file:///f.jpg", capturedAt: new Date().toISOString() });
    s = draftReducer(s, { type: "SET_GUIDE_VEHICLE_TYPE", vehicleType: "SUV" });
    s = draftReducer(s, { type: "SET_GUIDE_VEHICLE_TYPE", vehicleType: "PICKUP" });
    expect(s.draft.guideVehicleType).toBe("PICKUP");
    expect(s.draft.photos.FRONT?.uri).toBe("file:///f.jpg");
    for (const f of ["src/backend/core/coreBackendStore.ts", "src/backend/operations/coreOperations.ts", "src/store/commands.ts"]) expect(read(f)).not.toMatch(/guideVehicleType/);
  });

  it("no overclaiming: no AI / detection wording, the old 'not available yet' note is gone, manual entry stays", () => {
    const ui = read("src/components/plate/PlateScanner.tsx") + read("src/components/plate/PlateEntryCard.tsx") + read("src/presentation/plateEntry.ts") + read("src/presentation/plateScanFlow.ts");
    expect(ui).toMatch(/Enter manually/);
    expect(ui).not.toMatch(/isn't available yet/);
    expect(ui).not.toMatch(/Plate detected|\bOCR success|\bAI\b|automatically (fills|accepted|submitted)/i);
  });
});

describe("citizen 3-photo flow wiring", () => {
  const src = read("app/user/report/photos.tsx");
  it("asks the vehicle type once at the start, keeps it for every shot and retake, and passes it to the guide", () => {
    expect(src).toMatch(/useState\(draft\.guideVehicleType === undefined\)/);
    expect(src).toMatch(/guideProfile=\{draft\.guideVehicleType \?\? "GENERIC"\}/);
    expect(src).toMatch(/<VehicleTypeChip /);
    expect(src).toMatch(/if \(draft\.guideVehicleType === undefined\) setGuideVehicleType\("GENERIC"\)/);
    // the three shots and their order are unchanged
    expect(src).toMatch(/CITIZEN_PHOTO_SLOTS\.map/);
    expect(src).toMatch(/guide=\{activeSlot \? CITIZEN_CAMERA_GUIDE\[activeSlot\] : undefined\}/);
  });

  it("the officer camera keeps its own targets and the generic vehicle guide (no type picker)", () => {
    const officer = fs.readdirSync(path.join(ROOT, "app/officer")).map((f) => (f.endsWith(".tsx") ? read(`app/officer/${f}`) : "")).join("\n");
    expect(officer).not.toMatch(/VehicleTypePicker|guideProfile=/);
  });
});
