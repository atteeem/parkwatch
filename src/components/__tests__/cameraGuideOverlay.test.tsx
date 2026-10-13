// Camera framing guides: one shared overlay, a distinct line-art silhouette per shot.
import * as fs from "fs";
import * as path from "path";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text, View } from "react-native";
import { CameraGuideOverlay } from "../CameraGuideOverlay";
import { GUIDE_SHAPES } from "../cameraGuides/VehicleGuides";
import { CAMERA_GUIDE_HINT, CAMERA_GUIDE_LABEL, CITIZEN_CAMERA_GUIDE, CITIZEN_SHOT_INSTRUCTION, CameraGuideKind } from "../../presentation/cameraGuides";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const KINDS = Object.keys(GUIDE_SHAPES) as CameraGuideKind[];

const renderShape = (kind: CameraGuideKind) => {
  const Shape = GUIDE_SHAPES[kind];
  let r!: TestRenderer.ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(<Shape W={300} H={220} />);
  });
  return r;
};

describe("camera guide silhouettes", () => {
  it("every guide kind has a shape, a label and a one-line hint", () => {
    expect(KINDS.sort()).toEqual(["plate", "sign", "vehicle-front", "vehicle-rear", "vehicle-side"]);
    for (const k of KINDS) {
      expect(CAMERA_GUIDE_LABEL[k].length).toBeGreaterThan(0);
      expect(CAMERA_GUIDE_HINT[k].length).toBeLessThanOrEqual(42); // fits one line on a 320 px phone
    }
    expect([CAMERA_GUIDE_LABEL["vehicle-front"], CAMERA_GUIDE_LABEL["vehicle-side"], CAMERA_GUIDE_LABEL["vehicle-rear"]]).toEqual(["FRONT", "SIDE", "REAR"]);
  });

  it("front, side and rear are different drawings, each a single silhouette (not loose boxes)", () => {
    const front = JSON.stringify(renderShape("vehicle-front").toJSON());
    const side = JSON.stringify(renderShape("vehicle-side").toJSON());
    const rear = JSON.stringify(renderShape("vehicle-rear").toJSON());
    expect(new Set([front, side, rear]).size).toBe(3);
    for (const k of ["vehicle-front", "vehicle-side", "vehicle-rear"] as const) {
      const views = renderShape(k).root.findAllByType(View);
      expect(views.length).toBeGreaterThan(8);
      expect(views.length).toBeLessThan(30); // minimal, not cluttered
    }
  });

  it("all strokes are thin and semi-transparent white (camera stays visible)", () => {
    for (const k of KINDS) {
      for (const v of renderShape(k).root.findAllByType(View)) {
        const st = [v.props.style].flat(5).reduce((a: Record<string, unknown>, s: unknown) => ({ ...a, ...(s as object) }), {});
        if (typeof st.borderWidth === "number") expect(st.borderWidth).toBeLessThanOrEqual(1.5);
        for (const c of [st.borderColor, st.backgroundColor]) {
          if (typeof c === "string" && c !== "transparent") expect(c).toMatch(/^rgba\(255,255,255,0\.\d+\)$/);
        }
      }
    }
  });

  it("the overlay shows the shot label and hint, ignores touches and is hidden from screen readers", () => {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<CameraGuideOverlay kind="vehicle-rear" />);
    });
    const root = r.root.findAllByType(View)[0];
    expect(root.props.pointerEvents).toBe("none");
    expect(root.props.importantForAccessibility).toBe("no-hide-descendants");
    const texts = r.root.findAllByType(Text).map((t) => t.props.children);
    expect(texts).toEqual(["REAR", CAMERA_GUIDE_HINT["vehicle-rear"]]);
  });

  it("citizen shots get their own instruction; guides make no detection claims", () => {
    expect(Object.keys(CITIZEN_SHOT_INSTRUCTION).sort()).toEqual(Object.keys(CITIZEN_CAMERA_GUIDE).sort());
    expect(read("app/user/report/photos.tsx")).toMatch(/CITIZEN_SHOT_INSTRUCTION\[activeSlot\]/);
    const text = [...Object.values(CAMERA_GUIDE_HINT), ...Object.values(CITIZEN_SHOT_INSTRUCTION), read("src/components/cameraGuides/VehicleGuides.tsx")].join(" ");
    expect(text).not.toMatch(/\bAI\b|detect(ed|ing|ion)? (the )?(vehicle|car|plate)|automatic(ally)? (detect|recogn)/i);
  });
});
