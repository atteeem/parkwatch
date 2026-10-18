// T9.4 vehicle guide redesign: realistic anatomy, one visual family, a light
// premium paint style, and still only a framing aid (no detection).
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import * as fs from "fs";
import * as path from "path";
import { END, SIDE, VEHICLE_GUIDE_PROFILES, VehicleGuideProfile, endDrawing, sideDrawing, vehicleDrawing } from "../vehicleGuideGeometry";
import { DETAIL_WIDTH, GUIDE_FILL, GUIDE_GLASS_FILL, OUTLINE_WIDTH, guideLayers } from "../vehicleGuideStyle";
import { Path } from "react-native-svg";
import { VehicleGuide } from "../../components/cameraGuides/VehicleGuide";

const ALL: VehicleGuideProfile[] = ["GENERIC", ...VEHICLE_GUIDE_PROFILES];
const ROOT = path.resolve(__dirname, "../../..");
const nums = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
const alpha = (rgba: string) => Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(rgba)?.[1] ?? 1);

describe("side view anatomy", () => {
  it("windows split by pillars (more than one pane), wheels with rims, both head and tail lights", () => {
    for (const p of ALL) {
      const d = sideDrawing(p);
      expect(d.glass.length).toBeGreaterThanOrEqual(2); // front + rear (or quarter) windows
      expect(d.lights).toHaveLength(2); // headlight + tail light
      expect(d.wheels).toHaveLength(2);
      expect(d.outline).toMatch(/ A /); // wheel arches cut into the body
      expect(d.outline.match(/ C /g)!.length).toBeGreaterThanOrEqual(6); // curves, not a polygon
    }
  });
  it("long glasshouses get a quarter window; a coupe has two doors (one handle)", () => {
    expect(sideDrawing("SUV").glass).toHaveLength(3);
    expect(sideDrawing("UTILITY").glass).toHaveLength(3);
    expect(sideDrawing("SEDAN").glass).toHaveLength(2);
    const handles = (p: VehicleGuideProfile) => sideDrawing(p).details.find((x) => (x.match(/M/g) ?? []).length >= 1 && /L/.test(x) && x.split("M").length - 1 <= 2 && nums(x).length <= 8 && Math.abs(nums(x)[1]! - nums(x)[3]!) < 0.01);
    expect(handles("SPORT")!.split("M").length - 1).toBe(1);
    expect(handles("SEDAN")!.split("M").length - 1).toBe(2);
  });
  it("everything stays inside the viewBox", () => {
    for (const p of ALL) {
      const d = sideDrawing(p);
      const all = nums([d.outline, ...d.details, ...d.glass, ...d.lights].join(" "));
      expect(Math.min(...all)).toBeGreaterThanOrEqual(-1);
      expect(Math.max(...all)).toBeLessThanOrEqual(241);
    }
  });
});

describe("front / rear anatomy", () => {
  it("front: windscreen, two headlights, grille, plate, mirrors; rear: tail lights, plate recess, brake light", () => {
    for (const p of ALL) {
      const f = endDrawing(p, "FRONT");
      const r = endDrawing(p, "REAR");
      expect(f.glass).toHaveLength(1);
      expect(f.lights[0]!.split("M").length - 1).toBe(2); // left + right headlight
      expect(r.lights[0]!.split("M").length - 1).toBe(2); // left + right tail light
      expect(f.details.length).toBeGreaterThanOrEqual(8);
      expect(r.details.length).toBeGreaterThanOrEqual(8);
      expect(f.lights.join("")).not.toBe(r.lights.join(""));
      expect(f.glass[0]).not.toBe(r.glass[0]); // the rear window is smaller than the windscreen
    }
  });
  it("body outline is mirror-symmetric around the centre line", () => {
    for (const p of ALL) {
      const xs = nums(endDrawing(p, "FRONT").outline).filter((_, i) => i % 2 === 0);
      expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(160, 0);
    }
  });
  it("same vehicle family: front/rear width and roof come from the same proportions", () => {
    for (const p of ALL) {
      expect(nums(endDrawing(p, "FRONT").outline)).toEqual(nums(endDrawing(p, "REAR").outline));
      expect(END[p].halfW).toBeGreaterThan(END[p].roofHalfW);
      expect(SIDE[p].roof).toBeLessThan(SIDE[p].belt);
    }
  });
  it("rear style follows the body type: boot lid (sedan), hatch opening + wiper (hatch/SUV/van), tailgate (pickup)", () => {
    const wiper = (p: VehicleGuideProfile) => endDrawing(p, "REAR").details.length;
    expect(wiper("HATCHBACK")).toBe(wiper("SEDAN") + 1);
    expect(wiper("UTILITY")).toBe(wiper("SEDAN") + 1);
    expect(END.PICKUP.tailgate).toBe(true);
  });
});

describe("paint style (shared by the camera and the design preview)", () => {
  it("thin lines, soft details, faint fills: the camera stays visible", () => {
    const layers = guideLayers(vehicleDrawing("GENERIC", "SIDE"));
    expect(OUTLINE_WIDTH).toBeLessThanOrEqual(2);
    expect(DETAIL_WIDTH).toBeLessThan(OUTLINE_WIDTH);
    expect(alpha(GUIDE_FILL)).toBeLessThanOrEqual(0.08);
    expect(alpha(GUIDE_GLASS_FILL)).toBeLessThanOrEqual(0.12);
    for (const l of layers) {
      if (l.fill !== "none") expect(alpha(l.fill)).toBeLessThanOrEqual(0.15);
      if (l.stroke !== "none") expect(alpha(l.stroke)).toBeLessThan(1);
      expect(l.strokeWidth).toBeLessThanOrEqual(OUTLINE_WIDTH + 1.5);
    }
    // order: fills first, then dark under-strokes, then the white lines on top
    const firstLine = layers.findIndex((l) => l.key === "outline");
    expect(layers.findIndex((l) => l.key === "outline-shadow")).toBeLessThan(firstLine);
    expect(layers.findIndex((l) => l.key === "body-fill")).toBe(0);
    expect(layers.map((l) => l.key)).toEqual(expect.arrayContaining(["rim-0", "spokes-1", "hub-0", "glass-0", "light-1"]));
  });
  it("renders as SVG paths only, keyed per layer, with the existing test ids", () => {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<VehicleGuide profile="SUV" view="REAR" width={300} height={220} />);
    });
    const svg = r.root.findAll((n) => n.props.testID === "guide-SUV-REAR");
    expect(svg.length).toBeGreaterThan(0);
    expect(r.root.findAllByType(Path).length).toBe(guideLayers(vehicleDrawing("SUV", "REAR")).length);
  });
  it("still only a drawing: no detection or 'detected' wording in the guide code", () => {
    const src = ["src/presentation/vehicleGuideGeometry.ts", "src/presentation/vehicleGuideStyle.ts", "src/components/cameraGuides/VehicleGuide.tsx", "src/components/CameraGuideOverlay.tsx"]
      .map((p) => fs.readFileSync(path.join(ROOT, p), "utf8"))
      .join("\n");
    expect(src).not.toMatch(/tflite|detector|vehicle detected|sign detected|plate detected|recogni[sz]e\(/i);
  });
});
