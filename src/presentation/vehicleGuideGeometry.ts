// Vehicle framing guides (pure geometry). Generic, original body-type
// archetypes - no manufacturer shapes - described by a few proportions and
// turned into SVG paths. Purely a framing aid: the selected type never
// affects anything but the drawing.

export type VehicleGuideProfile = "GENERIC" | "SEDAN" | "SUV" | "HATCHBACK" | "PICKUP" | "SPORT" | "UTILITY";
export type VehicleView = "FRONT" | "SIDE" | "REAR";

export const VEHICLE_GUIDE_PROFILES: readonly VehicleGuideProfile[] = ["SEDAN", "SUV", "HATCHBACK", "PICKUP", "SPORT", "UTILITY"];

export const VEHICLE_TYPE_LABEL: Record<VehicleGuideProfile, string> = {
  GENERIC: "Not sure",
  SEDAN: "Sedan",
  SUV: "SUV",
  HATCHBACK: "Hatchback",
  PICKUP: "Pickup",
  SPORT: "Sport / Coupe",
  UTILITY: "Van / MPV",
};

/** Side view: car faces left. viewBox 0 0 240 100, ground at y = 94. */
export const SIDE_BOX = { w: 240, h: 100, ground: 94 };
/** Front / rear view: viewBox 0 0 160 120, centre x = 80, ground at y = 114. */
export const END_BOX = { w: 160, h: 120, ground: 114, cx: 80 };

type RearStyle = "notch" | "hatch" | "box" | "bed";

export type SideParams = {
  front: number; // x of the nose
  rear: number; // x of the tail
  sill: number; // y of the body bottom
  nose: number; // y of the top of the nose
  belt: number; // y of the beltline (bonnet meets windscreen)
  cowl: number; // x where the bonnet meets the windscreen
  roof: number; // y of the roof
  roofFront: number; // x where the windscreen meets the roof
  roofRear: number; // x where the roof ends
  glassBase: number; // x where the rear glass / hatch meets the body
  deck: number; // y of the boot deck / top of the tail
  rearStyle: RearStyle;
  bedTop?: number; // pickup: y of the bed rail
  wheelR: number;
  axleF: number;
  axleR: number;
};

export type EndParams = {
  halfW: number; // half body width
  shoulder: number; // y of the body's top edge at the sides
  cowl: number; // y where the glass meets the body (centre)
  bottom: number; // y of the bumper bottom
  glassHalfW: number; // half width of the glass at its base
  roofHalfW: number; // half width of the roof
  roof: number; // y of the roof
  tyreW: number;
  grilleW: number;
  grilleH: number;
  lightW: number;
  lightH: number;
  /** pickup: cab glass seen above a tailgate */
  tailgate?: boolean;
};

export const SIDE: Record<VehicleGuideProfile, SideParams> = {
  GENERIC: { front: 10, rear: 230, sill: 78, nose: 60, belt: 52, cowl: 76, roof: 22, roofFront: 104, roofRear: 156, glassBase: 190, deck: 50, rearStyle: "notch", wheelR: 13, axleF: 50, axleR: 188 },
  SEDAN: { front: 6, rear: 234, sill: 79, nose: 61, belt: 54, cowl: 74, roof: 24, roofFront: 104, roofRear: 150, glassBase: 184, deck: 50, rearStyle: "notch", wheelR: 13, axleF: 46, axleR: 190 },
  SUV: { front: 12, rear: 228, sill: 72, nose: 48, belt: 44, cowl: 72, roof: 12, roofFront: 96, roofRear: 196, glassBase: 225, deck: 42, rearStyle: "hatch", wheelR: 16, axleF: 52, axleR: 188 },
  HATCHBACK: { front: 26, rear: 214, sill: 78, nose: 60, belt: 52, cowl: 82, roof: 20, roofFront: 108, roofRear: 178, glassBase: 211, deck: 46, rearStyle: "hatch", wheelR: 13, axleF: 62, axleR: 180 },
  PICKUP: { front: 6, rear: 234, sill: 70, nose: 44, belt: 42, cowl: 62, roof: 12, roofFront: 82, roofRear: 128, glassBase: 128, deck: 42, rearStyle: "bed", bedTop: 42, wheelR: 16, axleF: 44, axleR: 194 },
  SPORT: { front: 4, rear: 236, sill: 82, nose: 68, belt: 60, cowl: 86, roof: 36, roofFront: 120, roofRear: 150, glassBase: 206, deck: 58, rearStyle: "hatch", wheelR: 14, axleF: 46, axleR: 192 },
  UTILITY: { front: 10, rear: 230, sill: 76, nose: 54, belt: 46, cowl: 48, roof: 8, roofFront: 74, roofRear: 222, glassBase: 230, deck: 14, rearStyle: "box", wheelR: 14, axleF: 44, axleR: 192 },
};

export const END: Record<VehicleGuideProfile, EndParams> = {
  GENERIC: { halfW: 64, shoulder: 60, cowl: 56, bottom: 98, glassHalfW: 52, roofHalfW: 40, roof: 30, tyreW: 16, grilleW: 40, grilleH: 9, lightW: 22, lightH: 8 },
  SEDAN: { halfW: 66, shoulder: 62, cowl: 58, bottom: 99, glassHalfW: 54, roofHalfW: 40, roof: 32, tyreW: 16, grilleW: 38, grilleH: 8, lightW: 24, lightH: 7 },
  SUV: { halfW: 70, shoulder: 50, cowl: 46, bottom: 95, glassHalfW: 58, roofHalfW: 50, roof: 14, tyreW: 18, grilleW: 48, grilleH: 14, lightW: 22, lightH: 9 },
  HATCHBACK: { halfW: 62, shoulder: 60, cowl: 56, bottom: 98, glassHalfW: 52, roofHalfW: 42, roof: 26, tyreW: 15, grilleW: 34, grilleH: 8, lightW: 20, lightH: 8 },
  PICKUP: { halfW: 72, shoulder: 48, cowl: 44, bottom: 94, glassHalfW: 54, roofHalfW: 46, roof: 14, tyreW: 19, grilleW: 56, grilleH: 18, lightW: 18, lightH: 11, tailgate: true },
  SPORT: { halfW: 72, shoulder: 70, cowl: 68, bottom: 100, glassHalfW: 54, roofHalfW: 34, roof: 46, tyreW: 20, grilleW: 50, grilleH: 6, lightW: 26, lightH: 6 },
  UTILITY: { halfW: 66, shoulder: 54, cowl: 50, bottom: 95, glassHalfW: 60, roofHalfW: 57, roof: 10, tyreW: 16, grilleW: 42, grilleH: 10, lightW: 20, lightH: 10 },
};

export type GuideDrawing = {
  viewBox: string;
  /** strongest line: the vehicle's exterior */
  outline: string;
  /** softer inner lines (glass, lights, plate, door line ...) */
  details: string[];
  wheels: { cx: number; cy: number; r: number }[];
};

const n = (v: number) => Math.round(v * 10) / 10;
const P = (...parts: (string | number)[]) => parts.map((p) => (typeof p === "number" ? n(p) : p)).join(" ");

/** Wheel-arch half width where a circle of radius r around (cx, cy) crosses y. */
const archHalf = (r: number, cy: number, y: number) => Math.sqrt(Math.max(0, r * r - (cy - y) * (cy - y)));

export function sideDrawing(profile: VehicleGuideProfile): GuideDrawing {
  const s = SIDE[profile];
  const { ground } = SIDE_BOX;
  const cy = ground - s.wheelR;
  const archR = s.wheelR + 3.5;
  const hw = archHalf(archR, cy, s.sill);

  let rear: string;
  if (s.rearStyle === "notch") {
    rear = P("Q", s.roofRear + (s.glassBase - s.roofRear) * 0.2, s.roof, s.glassBase, s.deck, "L", s.rear - 6, s.deck, "Q", s.rear, s.deck, s.rear, s.deck + 7);
  } else if (s.rearStyle === "hatch") {
    rear = P("Q", s.roofRear + (s.glassBase - s.roofRear) * 0.45, s.roof, s.glassBase, s.deck, "Q", s.rear, s.deck + 1, s.rear, s.deck + 9);
  } else if (s.rearStyle === "box") {
    rear = P("Q", s.rear - 1, s.roof, s.rear, s.roof + 9);
  } else {
    const bed = s.bedTop ?? s.belt;
    rear = P("Q", s.roofRear + 3, s.roof, s.roofRear + 3, s.roof + 6, "L", s.roofRear + 3, bed, "L", s.rear - 3, bed, "Q", s.rear, bed, s.rear, bed + 4);
  }

  const outline = P(
    "M", s.front + 6, s.sill,
    "Q", s.front, s.sill, s.front, s.sill - 6,
    "L", s.front, s.nose + 7,
    "Q", s.front, s.nose, s.front + 8, s.nose,
    // bonnet rising to the cowl
    "Q", s.front + (s.cowl - s.front) * 0.55, s.nose - (s.nose - s.belt) * 0.85, s.cowl, s.belt,
    // windscreen curving into the roof
    "Q", s.roofFront - (s.roofFront - s.cowl) * 0.25, s.roof, s.roofFront + 6, s.roof,
    "L", s.roofRear - 6, s.roof,
  ) + " " + rear + " " + P(
    "L", s.rear, s.sill - 6,
    "Q", s.rear, s.sill, s.rear - 6, s.sill,
    "L", s.axleR + hw, s.sill,
    "A", archR, archR, 0, 0, 0, s.axleR - hw, s.sill,
    "L", s.axleF + hw, s.sill,
    "A", archR, archR, 0, 0, 0, s.axleF - hw, s.sill,
    "Z",
  );

  // Side windows: inset of the greenhouse down to the beltline, with a B-pillar.
  const top = s.roof + 4.5;
  const winRear =
    s.rearStyle === "box" ? s.rear - 9 : s.rearStyle === "bed" ? s.roofRear - 1 : s.rearStyle === "hatch" ? s.glassBase - (s.glassBase - s.roofRear) * 0.55 : s.glassBase - (s.glassBase - s.roofRear) * 0.45;
  const winFront = s.cowl + 6;
  const bX = winFront + (winRear - winFront) * (s.rearStyle === "box" ? 0.36 : 0.5);
  const windows = P(
    "M", winFront, s.belt - 1,
    "Q", s.roofFront - (s.roofFront - s.cowl) * 0.2, top, s.roofFront + 7, top,
    "L", Math.min(winRear, s.roofRear) - 4, top,
  ) + " " + (s.rearStyle === "box"
    ? P("Q", winRear, top, winRear, top + 6, "L", winRear, s.belt - 1)
    : s.rearStyle === "bed"
      ? P("L", winRear, top, "L", winRear, s.belt - 1)
      : P("Q", s.roofRear + 2, top, winRear, s.belt - 1)) + " " + P("Z");
  const pillar = P("M", bX, top, "L", bX, s.belt - 1);
  const door = P("M", bX + 1, s.belt + 2, "L", bX + 1, s.sill - 3);
  const head = P("M", s.front + 2, s.nose + 6, "L", s.front + 15, s.nose + 3.5);
  const tailTop = s.rearStyle === "box" ? s.belt + 2 : s.rearStyle === "bed" ? (s.bedTop ?? s.belt) + 4 : s.deck + 6;
  const tail = P("M", s.rear - 1.5, tailTop, "L", s.rear - 1.5, tailTop + 9);
  const details = [windows, pillar, door, head, tail];
  if (s.rearStyle === "bed") details.push(P("M", s.roofRear + 9, (s.bedTop ?? s.belt) + 5, "L", s.rear - 5, (s.bedTop ?? s.belt) + 5));
  if (s.rearStyle === "box" && profile === "UTILITY") details.push(P("M", bX + (winRear - bX) * 0.55, top, "L", bX + (winRear - bX) * 0.55, s.belt - 1)); // second side pillar

  return {
    viewBox: `0 0 ${SIDE_BOX.w} ${SIDE_BOX.h}`,
    outline,
    details,
    wheels: [
      { cx: s.axleF, cy, r: s.wheelR },
      { cx: s.axleR, cy, r: s.wheelR },
    ],
  };
}

/** Front or rear view. The body and cabin are shared; the details tell front from rear. */
export function endDrawing(profile: VehicleGuideProfile, view: "FRONT" | "REAR"): GuideDrawing {
  const e = END[profile];
  const { cx, ground } = END_BOX;
  const L = cx - e.halfW;
  const R = cx + e.halfW;
  const gl = cx - e.glassHalfW;
  const gr = cx + e.glassHalfW;
  const rl = cx - e.roofHalfW;
  const rr = cx + e.roofHalfW;

  const outline = P(
    "M", L + 6, e.bottom,
    "Q", L, e.bottom, L, e.bottom - 6,
    "L", L, e.shoulder + 7,
    "Q", L, e.shoulder, L + 8, e.shoulder - 1,
    "L", gl, e.cowl,
    "L", rl, e.roof + 6,
    "Q", rl + 1, e.roof, rl + 8, e.roof,
    "L", rr - 8, e.roof,
    "Q", rr - 1, e.roof, rr, e.roof + 6,
    "L", gr, e.cowl,
    "L", R - 8, e.shoulder - 1,
    "Q", R, e.shoulder, R, e.shoulder + 7,
    "L", R, e.bottom - 6,
    "Q", R, e.bottom, R - 6, e.bottom,
    "Z",
  );

  // Glass: windscreen (front) or a smaller rear window.
  const inset = view === "FRONT" ? 5 : 9;
  const gTop = e.roof + (view === "FRONT" ? 5 : 7);
  const gBase = e.cowl - (view === "FRONT" ? 2 : 4);
  const glass = P(
    "M", gl + inset, gBase,
    "L", rl + inset * 0.6, gTop + 3,
    "Q", rl + inset * 0.6, gTop, rl + inset * 0.6 + 4, gTop,
    "L", rr - inset * 0.6 - 4, gTop,
    "Q", rr - inset * 0.6, gTop, rr - inset * 0.6, gTop + 3,
    "L", gr - inset, gBase,
    "Z",
  );

  // Tyres: the visible lower part under the body (top edge hidden behind it).
  const tyre = (x: number) => P("M", x, e.bottom, "L", x, ground - 3, "Q", x, ground, x + 3, ground, "L", x + e.tyreW - 3, ground, "Q", x + e.tyreW, ground, x + e.tyreW, ground - 3, "L", x + e.tyreW, e.bottom);
  const tyres = [tyre(L + 5), tyre(R - 5 - e.tyreW)];
  const bumper = P("M", L + 10, e.bottom - 9, "L", R - 10, e.bottom - 9);
  const plateW = 28;
  const plateH = 6.5;

  const details = [glass, ...tyres, bumper];
  if (view === "FRONT") {
    const ly = e.shoulder + 6;
    const lightL = P("M", L + 5, ly, "L", L + 5 + e.lightW, ly + 2, "L", L + 3 + e.lightW, ly + e.lightH, "L", L + 5, ly + e.lightH - 1, "Z");
    const lightR = P("M", R - 5, ly, "L", R - 5 - e.lightW, ly + 2, "L", R - 3 - e.lightW, ly + e.lightH, "L", R - 5, ly + e.lightH - 1, "Z");
    const gy = ly + 1;
    const grille = P(
      "M", cx - e.grilleW / 2 + 3, gy,
      "L", cx + e.grilleW / 2 - 3, gy,
      "Q", cx + e.grilleW / 2, gy, cx + e.grilleW / 2, gy + 3,
      "L", cx + e.grilleW / 2, gy + e.grilleH - 3,
      "Q", cx + e.grilleW / 2, gy + e.grilleH, cx + e.grilleW / 2 - 3, gy + e.grilleH,
      "L", cx - e.grilleW / 2 + 3, gy + e.grilleH,
      "Q", cx - e.grilleW / 2, gy + e.grilleH, cx - e.grilleW / 2, gy + e.grilleH - 3,
      "L", cx - e.grilleW / 2, gy + 3,
      "Q", cx - e.grilleW / 2, gy, cx - e.grilleW / 2 + 3, gy,
      "Z",
    );
    const py = Math.min(e.bottom - 9 - plateH - 2, gy + e.grilleH + 5);
    const plate = rect(cx - plateW / 2, py, plateW, plateH);
    const mirrorL = P("M", gl - 1, e.cowl - 4, "L", gl - 11, e.cowl - 6, "Q", gl - 13, e.cowl - 1, gl - 9, e.cowl, "L", gl - 1, e.cowl - 1);
    const mirrorR = P("M", gr + 1, e.cowl - 4, "L", gr + 11, e.cowl - 6, "Q", gr + 13, e.cowl - 1, gr + 9, e.cowl, "L", gr + 1, e.cowl - 1);
    details.push(lightL, lightR, grille, plate, mirrorL, mirrorR);
  } else {
    // Rear: tail lights at the outer corners, plate higher up, tailgate/boot edge; no grille.
    const ty = e.shoulder + 3;
    const tailL = P("M", L + 3, ty, "L", L + 3 + e.lightW, ty, "L", L + 3 + e.lightW, ty + e.lightH, "L", L + 3, ty + e.lightH + 2, "Z");
    const tailR = P("M", R - 3, ty, "L", R - 3 - e.lightW, ty, "L", R - 3 - e.lightW, ty + e.lightH, "L", R - 3, ty + e.lightH + 2, "Z");
    const py = e.shoulder + (e.bottom - 9 - e.shoulder) * 0.45;
    const plate = rect(cx - plateW / 2, py, plateW, plateH);
    const gate = e.tailgate
      ? rect(L + 6 + e.lightW, e.shoulder + 2, 2 * (e.halfW - 6 - e.lightW), e.bottom - 12 - e.shoulder)
      : P("M", L + 6 + e.lightW, ty + e.lightH / 2, "L", R - 6 - e.lightW, ty + e.lightH / 2);
    details.push(tailL, tailR, plate, gate);
  }

  return { viewBox: `0 0 ${END_BOX.w} ${END_BOX.h}`, outline, details, wheels: [] };
}

function rect(x: number, y: number, w: number, h: number): string {
  const r = 1.5;
  return P("M", x + r, y, "L", x + w - r, y, "Q", x + w, y, x + w, y + r, "L", x + w, y + h - r, "Q", x + w, y + h, x + w - r, y + h, "L", x + r, y + h, "Q", x, y + h, x, y + h - r, "L", x, y + r, "Q", x, y, x + r, y, "Z");
}

export function vehicleDrawing(profile: VehicleGuideProfile, view: VehicleView): GuideDrawing {
  return view === "SIDE" ? sideDrawing(profile) : endDrawing(profile, view);
}

// ---------------------------------------------------------------------------
// Simple metrics (used by tests to check the archetypes keep their character)

/** Side view: height above ground relative to length (taller = larger). */
export const sideHeightRatio = (p: VehicleGuideProfile) => (SIDE_BOX.ground - SIDE[p].roof) / (SIDE[p].rear - SIDE[p].front);
/** Side view: share of the body length covered by the roof (boxier = larger). */
export const roofLengthShare = (p: VehicleGuideProfile) => (SIDE[p].roofRear - SIDE[p].roofFront) / (SIDE[p].rear - SIDE[p].front);
/** Front view: total height / width. */
export const endHeightRatio = (p: VehicleGuideProfile) => (END_BOX.ground - END[p].roof) / (2 * END[p].halfW);
