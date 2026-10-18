// Vehicle framing guides (pure geometry). Generic, original body-type
// archetypes - no manufacturer shapes - described by a few proportions and
// turned into SVG paths. Purely a framing aid: the selected type never
// affects anything but the drawing.
//
// T9.4 redesign: smooth cubic curves and real automotive anatomy (bonnet,
// raked windscreen, arched roof, A/B/C pillars, flared wheel arches, rims,
// mirrors, swept head/tail lights, grille, bumper, boot/hatch line, plate
// area). Glass and lights are separate layers so the renderer can give them a
// faint fill; every view of a type is built from the same proportions, so
// front, side and rear read as one vehicle.

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
  /** strongest line: the vehicle's exterior (with a ghost fill) */
  outline: string;
  /** soft inner lines (panel / door cuts, bonnet creases, grille, bumper, plate, mirrors, tyres ...) */
  details: string[];
  /** windows / windscreen: soft line + faint glass tint */
  glass: string[];
  /** head / tail lights: slightly brighter, faint fill */
  lights: string[];
  /** side view wheels (tyre + rim + spokes are drawn from these) */
  wheels: { cx: number; cy: number; r: number }[];
};

const n = (v: number) => Math.round(v * 10) / 10;
const P = (...parts: (string | number)[]) => parts.map((p) => (typeof p === "number" ? n(p) : p)).join(" ");

/** Wheel-arch half width where a circle of radius r around (cx, cy) crosses y. */
const archHalf = (r: number, cy: number, y: number) => Math.sqrt(Math.max(0, r * r - (cy - y) * (cy - y)));

// ---------------------------------------------------------------------------
// Symmetric shapes (front / rear views): the left half is described from the
// bottom centre up to the top centre; the right half is its mirror image.

type Pt = [number, number];
type Seg = { L: Pt } | { C: [Pt, Pt, Pt] };

function symmetric(cx: number, start: Pt, left: Seg[]): string {
  const mx = (p: Pt): Pt => [2 * cx - p[0], p[1]];
  const parts: (string | number)[] = ["M", start[0], start[1]];
  for (const s of left) {
    if ("L" in s) parts.push("L", ...s.L);
    else parts.push("C", ...s.C[0], ...s.C[1], ...s.C[2]);
  }
  // back down the right side: each segment reversed and mirrored
  const ends: Pt[] = [start, ...left.map((s) => ("L" in s ? s.L : s.C[2]))];
  for (let i = left.length - 1; i >= 0; i--) {
    const s = left[i]!;
    const to = mx(ends[i]!);
    if ("L" in s) parts.push("L", ...to);
    else parts.push("C", ...mx(s.C[1]), ...mx(s.C[0]), ...to);
  }
  parts.push("Z");
  return P(...parts);
}

/** An open path and its mirror image (e.g. both headlights) as one path string. */
function pair(cx: number, start: Pt, segs: Seg[], close = false): string {
  const one = (m: (p: Pt) => Pt) => {
    const parts: (string | number)[] = ["M", ...m(start)];
    for (const s of segs) {
      if ("L" in s) parts.push("L", ...m(s.L));
      else parts.push("C", ...m(s.C[0]), ...m(s.C[1]), ...m(s.C[2]));
    }
    if (close) parts.push("Z");
    return P(...parts);
  };
  return `${one((p) => p)} ${one((p) => [2 * cx - p[0], p[1]])}`;
}

function roundedRect(x: number, y: number, w: number, h: number, r = 1.5): string {
  return P("M", x + r, y, "L", x + w - r, y, "Q", x + w, y, x + w, y + r, "L", x + w, y + h - r, "Q", x + w, y + h, x + w - r, y + h, "L", x + r, y + h, "Q", x, y + h, x, y + h - r, "L", x, y + r, "Q", x, y, x + r, y, "Z");
}

// ---------------------------------------------------------------------------
// Side view

export function sideDrawing(profile: VehicleGuideProfile): GuideDrawing {
  const s = SIDE[profile];
  const { ground } = SIDE_BOX;
  const cy = ground - s.wheelR;
  const archR = s.wheelR + 3.2;
  const hw = archHalf(archR, cy, s.sill);
  const bed = s.bedTop ?? s.belt;
  const len = s.rear - s.front;

  // Rear end, from the end of the roof down to the top of the tail.
  let rear: string;
  if (s.rearStyle === "notch") {
    rear = P(
      "C", s.roofRear + (s.glassBase - s.roofRear) * 0.45, s.roof + 2.5, s.glassBase - 7, s.deck - 1.5, s.glassBase, s.deck,
      "C", s.glassBase + (s.rear - s.glassBase) * 0.5, s.deck + 0.4, s.rear - 4, s.deck - 0.6, s.rear - 1.5, s.deck + 2.5,
      "C", s.rear - 0.5, s.deck + 4, s.rear, s.deck + 6, s.rear, s.deck + 9,
    );
  } else if (s.rearStyle === "hatch") {
    rear = P(
      "C", s.roofRear + (s.glassBase - s.roofRear) * 0.55, s.roof + 1.5, s.glassBase - 2.5, s.deck - 4, s.glassBase, s.deck,
      "C", s.rear - 1.5, s.deck + 1.5, s.rear, s.deck + 4, s.rear, s.deck + 10,
    );
  } else if (s.rearStyle === "box") {
    rear = P("C", s.rear - 5, s.roof - 0.5, s.rear, s.roof + 1.5, s.rear, s.roof + 9);
  } else {
    rear = P(
      "C", s.roofRear + 3, s.roof, s.roofRear + 4.5, s.roof + 3, s.roofRear + 4.5, s.roof + 8,
      "L", s.roofRear + 4.5, bed,
      "L", s.rear - 4, bed,
      "C", s.rear - 1, bed, s.rear, bed + 1.5, s.rear, bed + 5,
    );
  }

  const outline =
    P(
      "M", s.front + 9, s.sill,
      // front bumper, rounded nose
      "C", s.front + 2.5, s.sill, s.front, s.sill - 4, s.front, s.sill - 9,
      "C", s.front, s.nose + 8, s.front + 1, s.nose + 1.5, s.front + 8, s.nose,
      // bonnet rising gently to the cowl
      "C", s.front + (s.cowl - s.front) * 0.38, s.nose - (s.nose - s.belt) * 0.6, s.cowl - (s.cowl - s.front) * 0.22, s.belt + 0.8, s.cowl, s.belt,
      // raked windscreen curving into the roof
      "C", s.cowl + (s.roofFront - s.cowl) * 0.5, s.belt - (s.belt - s.roof) * 0.62, s.roofFront - (s.roofFront - s.cowl) * 0.18, s.roof + 0.8, s.roofFront + 4, s.roof,
      // slightly arched roof
      "C", s.roofFront + (s.roofRear - s.roofFront) * 0.35, s.roof - 1.6, s.roofRear - (s.roofRear - s.roofFront) * 0.3, s.roof - 1.2, s.roofRear, s.roof + 0.8,
    ) +
    " " + rear + " " +
    P(
      "L", s.rear, s.sill - 9,
      "C", s.rear, s.sill - 4, s.rear - 2.5, s.sill, s.rear - 9, s.sill,
      "L", s.axleR + hw, s.sill,
      "A", archR, archR, 0, 0, 0, s.axleR - hw, s.sill,
      "L", s.axleF + hw, s.sill,
      "A", archR, archR, 0, 0, 0, s.axleF - hw, s.sill,
      "Z",
    );

  // Daylight opening: windows under the roof, down to a beltline that rises slightly to the rear (wedge).
  const top = s.roof + 3.8;
  const beltAt = (x: number) => s.belt - 1.5 - ((x - s.cowl) / Math.max(1, s.rear - s.cowl)) * 2.5;
  const winRear =
    s.rearStyle === "box" ? s.rear - 8 : s.rearStyle === "bed" ? s.roofRear : s.rearStyle === "hatch" ? s.glassBase - (s.glassBase - s.roofRear) * 0.5 : s.glassBase - (s.glassBase - s.roofRear) * 0.45;
  const winFront = s.cowl + 7;
  const twoDoor = profile === "SPORT";
  const bX = winFront + (winRear - winFront) * (twoDoor ? 0.66 : s.rearStyle === "box" ? 0.3 : s.rearStyle === "bed" ? 0.56 : 0.5);
  const roofEnd = Math.min(winRear, s.roofRear) - 3;
  const frontWin = P(
    "M", winFront, beltAt(winFront),
    "C", winFront + (s.roofFront - winFront) * 0.5, beltAt(winFront) - (beltAt(winFront) - top) * 0.62, s.roofFront - (s.roofFront - s.cowl) * 0.12, top + 0.6, s.roofFront + 6, top,
    "L", bX - 2, top - 0.2,
    "L", bX - 2, beltAt(bX - 2),
    "Z",
  );
  const glass = [frontWin];
  // C pillar for vans / SUVs / 4-door: a rear door window, plus a quarter window on the long glasshouses.
  const quarter = s.rearStyle === "box" || profile === "SUV";
  const cX = quarter ? bX + (winRear - bX) * 0.55 : winRear;
  const rearDoorEnd = quarter ? cX - 2 : winRear;
  const curvedTail = !quarter && s.rearStyle !== "bed";
  glass.push(
    curvedTail
      ? P("M", bX + 2, top - 0.2, "L", roofEnd, top, "C", s.roofRear + 1, top + 0.4, winRear - 2, beltAt(winRear) - 6, winRear, beltAt(winRear), "L", bX + 2, beltAt(bX + 2), "Z")
      : P("M", bX + 2, top - 0.2, "L", rearDoorEnd, top, "L", rearDoorEnd, beltAt(rearDoorEnd), "L", bX + 2, beltAt(bX + 2), "Z"),
  );
  if (quarter) {
    glass.push(
      s.rearStyle === "box"
        ? P("M", cX + 2, top, "L", winRear - 3, top, "C", winRear - 1, top, winRear, top + 1, winRear, top + 4, "L", winRear, beltAt(winRear), "L", cX + 2, beltAt(cX + 2), "Z")
        : P("M", cX + 2, top, "L", roofEnd - 2, top + 0.3, "C", s.roofRear, top + 1, winRear - 2, beltAt(winRear) - 5, winRear, beltAt(winRear), "L", cX + 2, beltAt(cX + 2), "Z"),
    );
  }

  // Door cuts: front door behind the front arch, rear door ahead of the rear arch.
  const frontDoorX = Math.max(s.cowl + 1, s.axleF + archR + 3);
  const lowFront = s.sill - 3;
  const fd = P("M", frontDoorX, s.belt + 0.5, "C", frontDoorX - 1.5, s.belt + (s.sill - s.belt) * 0.5, frontDoorX - 0.5, lowFront - 2, frontDoorX + 1.5, lowFront);
  const bd = P("M", bX, beltAt(bX) + 1, "L", bX + 0.6, lowFront);
  const rearDoorX = twoDoor ? bX : Math.min(rearDoorEnd + 1.5, s.axleR - archR - 2);
  const rd = twoDoor ? "" : P("M", rearDoorX, beltAt(rearDoorX) + 1, "C", rearDoorX + 0.4, s.belt + (s.sill - s.belt) * 0.55, rearDoorX - 1, lowFront - 3, rearDoorX - 3.5, lowFront);
  const hy = s.belt + (s.sill - s.belt) * 0.3;
  const handles = P("M", bX - 10, hy, "L", bX - 4.5, hy) + (twoDoor ? "" : " " + P("M", rearDoorX - 9, hy, "L", rearDoorX - 3.5, hy));

  // Shoulder (character) line from behind the headlight to the tail light.
  const tailY = s.rearStyle === "box" ? s.belt + 4 : s.rearStyle === "bed" ? bed + 5 : s.deck + 5;
  const shoulder = P("M", s.front + 22, s.nose + 4, "C", s.front + len * 0.35, beltAt(s.cowl) + 6.5, s.rear - len * 0.3, tailY + 2.5, s.rear - 10, tailY + 2);
  const rocker = P("M", s.axleF + hw + 3, s.sill - 3, "L", s.axleR - hw - 3, s.sill - 3);
  const lipR = archR + 1.8;
  const lw = archHalf(lipR, cy, s.sill);
  const lips = P("M", s.axleF + lw, s.sill, "A", lipR, lipR, 0, 0, 0, s.axleF - lw, s.sill) + " " + P("M", s.axleR + lw, s.sill, "A", lipR, lipR, 0, 0, 0, s.axleR - lw, s.sill);
  const mirror = P("M", s.cowl + 4, s.belt - 0.5, "C", s.cowl + 4.5, s.belt - 6, s.cowl + 10, s.belt - 7.5, s.cowl + 12.5, s.belt - 4, "C", s.cowl + 13, s.belt - 2, s.cowl + 11, s.belt - 0.5, s.cowl + 4, s.belt - 0.5, "Z");
  const bumperF = P("M", s.front + 1, s.sill - 10, "C", s.front + 8, s.sill - 9, s.axleF - archR - 6, s.sill - 8, s.axleF - archR - 1, s.sill - 7);
  const bumperR = P("M", s.rear - 0.5, s.sill - 10, "C", s.rear - 7, s.sill - 9, s.axleR + archR + 6, s.sill - 8, s.axleR + archR + 1, s.sill - 7);

  const head = P(
    "M", s.front + 2.5, s.nose + 2.5,
    "C", s.front + 8, s.nose + 0.8, s.front + 15, s.nose + 0.8, s.front + 20, s.nose + 2.2,
    "L", s.front + 18, s.nose + 5.5,
    "C", s.front + 12, s.nose + 6.5, s.front + 6, s.nose + 6.8, s.front + 1.8, s.nose + 6.2,
    "Z",
  );
  const tail = P(
    "M", s.rear - 0.6, tailY,
    "L", s.rear - 9, tailY + 0.8,
    "C", s.rear - 11.5, tailY + 3, s.rear - 10.5, tailY + 6.2, s.rear - 7, tailY + 6.6,
    "L", s.rear - 0.6, tailY + 6.2,
    "Z",
  );

  const details = [fd, bd, ...(rd ? [rd] : []), handles, shoulder, rocker, lips, mirror, bumperF, bumperR];
  if (quarter) details.push(P("M", cX, top + 0.5, "L", cX + 0.5, beltAt(cX)));
  if (s.rearStyle === "bed") details.push(P("M", s.roofRear + 9, bed + 3.5, "L", s.rear - 5, bed + 3.5), P("M", s.rear - 4, bed + 4, "L", s.rear - 4, s.sill - 11));
  if (s.rearStyle === "notch") details.push(P("M", s.glassBase + 4, s.deck + 1.5, "C", s.glassBase + 14, s.deck + 2.2, s.rear - 12, s.deck + 2, s.rear - 3, s.deck + 3.5)); // boot lid
  if (profile === "SUV" || profile === "UTILITY") details.push(P("M", s.roofFront + 10, s.roof - 1.8, "L", s.roofRear - 8, s.roof - 1.8)); // roof rail

  return {
    viewBox: `0 0 ${SIDE_BOX.w} ${SIDE_BOX.h}`,
    outline,
    details,
    glass,
    lights: [head, tail],
    wheels: [
      { cx: s.axleF, cy, r: s.wheelR },
      { cx: s.axleR, cy, r: s.wheelR },
    ],
  };
}

// ---------------------------------------------------------------------------
// Front / rear views. Body, cabin, mirrors and tyres are shared; the details
// tell front from rear.

export function endDrawing(profile: VehicleGuideProfile, view: "FRONT" | "REAR"): GuideDrawing {
  const e = END[profile];
  const style = SIDE[profile].rearStyle;
  const { cx, ground } = END_BOX;
  const L = cx - e.halfW;
  const gl = cx - e.glassHalfW;
  const rl = cx - e.roofHalfW;
  const bulge = e.shoulder + (e.bottom - e.shoulder) * 0.42;

  const outline = symmetric(cx, [cx, e.bottom], [
    { L: [L + 8, e.bottom] },
    { C: [[L + 2.5, e.bottom], [L - 0.5, e.bottom - 3], [L - 0.5, e.bottom - 9]] },
    // fender, widest at the wheel line
    { C: [[L - 0.8, bulge + 6], [L - 1.2, bulge - 4], [L, e.shoulder + 6]] },
    { C: [[L + 0.8, e.shoulder + 1], [L + 4, e.shoulder - 1.2], [L + 10, e.shoulder - 1.5]] },
    // bonnet / boot edge to the A (or C) pillar base
    { C: [[gl - 6, e.shoulder - 2.5], [gl - 2, e.cowl + 1.5], [gl, e.cowl]] },
    // pillar up to the roof, which is slightly domed
    { C: [[gl + (rl - gl) * 0.35, e.cowl - (e.cowl - e.roof) * 0.45], [rl - 1.5, e.roof + 6], [rl + 1.5, e.roof + 2]] },
    { C: [[rl + 4, e.roof - 0.4], [cx - e.roofHalfW * 0.5, e.roof - 1.4], [cx, e.roof - 1.4]] },
  ]);

  // Glass: windscreen (front) or a smaller rear window.
  const inset = view === "FRONT" ? 5 : 9;
  const gTop = e.roof + (view === "FRONT" ? 4.5 : 6.5);
  const gBase = e.cowl - (view === "FRONT" ? 2 : 4);
  const glassPath = symmetric(cx, [cx, gBase + 0.8], [
    { L: [gl + inset + 3, gBase] },
    { C: [[gl + inset, gBase - 0.2], [gl + inset - 0.5, gBase - 2], [gl + inset + 0.5, gBase - 4]] },
    { C: [[gl + inset + (rl - gl) * 0.4, gBase - (gBase - gTop) * 0.55], [rl + inset * 0.6 - 0.5, gTop + 3], [rl + inset * 0.6 + 3, gTop + 0.3]] },
    { C: [[rl + inset * 0.6 + 8, gTop - 0.6], [cx - e.roofHalfW * 0.4, gTop - 0.9], [cx, gTop - 0.9]] },
  ]);

  // Mirrors (seen from both ends) and tyres under the body.
  const mirrors = pair(cx, [gl - 0.5, e.cowl - 3.5], [
    { C: [[gl - 5, e.cowl - 6.5], [gl - 11, e.cowl - 7], [gl - 13, e.cowl - 4]] },
    { C: [[gl - 14, e.cowl - 1], [gl - 11, e.cowl + 0.6], [gl - 7, e.cowl]] },
    { L: [gl - 0.5, e.cowl - 1] },
  ], true);
  const tyre = (x: number) =>
    P("M", x, e.bottom - 1, "L", x, ground - 3.5, "C", x, ground - 1, x + 1.5, ground, x + 4, ground, "L", x + e.tyreW - 4, ground, "C", x + e.tyreW - 1.5, ground, x + e.tyreW, ground - 1, x + e.tyreW, ground - 3.5, "L", x + e.tyreW, e.bottom - 1);
  const tyres = tyre(L + 5) + " " + tyre(cx + e.halfW - 5 - e.tyreW);
  const bumperY = e.bottom - 10;
  const bumper = P("M", L + 3, bumperY, "C", L + 22, bumperY + 2.2, cx + e.halfW - 22, bumperY + 2.2, cx + e.halfW - 3, bumperY);
  const plateW = 28;
  const plateH = 6.5;

  const details = [mirrors, tyres, bumper];
  const lights: string[] = [];

  if (view === "FRONT") {
    const ly = e.shoulder + 4;
    const lw = e.lightW;
    lights.push(
      pair(cx, [L + 2.5, ly + 1.5], [
        { C: [[L + 7, ly - 0.8], [L + lw * 0.7, ly - 0.4], [L + lw + 3, ly + 2]] },
        { C: [[L + lw + 2, ly + e.lightH * 0.7], [L + lw * 0.65, ly + e.lightH], [L + 5, ly + e.lightH]] },
        { C: [[L + 2.5, ly + e.lightH - 0.8], [L + 1.8, ly + 3.5], [L + 2.5, ly + 1.5]] },
      ]),
    );
    // daytime-running-light accent inside each headlight
    details.push(pair(cx, [L + 5, ly + e.lightH * 0.55], [{ C: [[L + lw * 0.4, ly + e.lightH * 0.45], [L + lw * 0.8, ly + e.lightH * 0.3], [L + lw + 1, ly + 2.8]] }]));
    const gy = ly + 1.5;
    const gw = e.grilleW / 2;
    const grille = symmetric(cx, [cx, gy + e.grilleH], [
      { L: [cx - gw + 4, gy + e.grilleH] },
      { C: [[cx - gw + 1, gy + e.grilleH], [cx - gw, gy + e.grilleH - 2], [cx - gw - 0.5, gy + e.grilleH - 4]] },
      { L: [cx - gw - 1.5, gy + 2.5] },
      { C: [[cx - gw - 1.5, gy + 0.5], [cx - gw, gy - 0.3], [cx - gw + 2.5, gy - 0.3]] },
      { L: [cx, gy - 0.3] },
    ]);
    const slats = Array.from({ length: e.grilleH >= 12 ? 3 : 2 }, (_, i) => {
      const y = gy + (e.grilleH * (i + 1)) / ((e.grilleH >= 12 ? 3 : 2) + 1);
      return P("M", cx - gw + 2.5, y, "L", cx + gw - 2.5, y);
    }).join(" ");
    const creases = pair(cx, [cx - e.glassHalfW * 0.42, e.cowl + 1.5], [{ C: [[cx - e.glassHalfW * 0.42, e.cowl + (gy - e.cowl) * 0.5], [cx - gw * 0.85, gy - 4], [cx - gw * 0.75, gy - 1.8]] }]);
    const iy0 = Math.max(gy + e.grilleH + 3, bumperY + 2.5);
    const intake = symmetric(cx, [cx, e.bottom - 3], [
      { L: [cx - e.halfW * 0.48, e.bottom - 3] },
      { C: [[cx - e.halfW * 0.53, e.bottom - 3], [cx - e.halfW * 0.56, iy0 + 1], [cx - e.halfW * 0.5, iy0]] },
      { L: [cx, iy0] },
    ]);
    const fogs = pair(cx, [L + 8, e.bottom - 6.5], [{ L: [L + 15, e.bottom - 7.2] }]);
    const py = Math.min(iy0 - plateH - 1.5, gy + e.grilleH + 3);
    details.push(grille, slats, creases, intake, fogs, roundedRect(cx - plateW / 2, py, plateW, plateH));
  } else {
    // Rear: wrap-around tail lights, boot lid / tailgate, plate recess, reflectors, exhaust.
    const ty = e.shoulder + 2;
    const lw = e.lightW;
    lights.push(
      pair(cx, [L + 0.5, ty + 0.5], [
        { C: [[L + 6, ty - 1.2], [L + lw, ty - 0.6], [L + lw + 3.5, ty + 1.2]] },
        { L: [L + lw + 1.5, ty + e.lightH] },
        { C: [[L + lw * 0.55, ty + e.lightH + 1.6], [L + 3.5, ty + e.lightH + 1.6], [L + 0.6, ty + e.lightH + 0.5]] },
      ], true),
    );
    details.push(pair(cx, [L + 3, ty + e.lightH * 0.5], [{ L: [L + lw, ty + e.lightH * 0.42] }]));
    const py = e.shoulder + (bumperY - e.shoulder) * 0.48;
    const plate = roundedRect(cx - plateW / 2, py, plateW, plateH);
    const recess = roundedRect(cx - plateW / 2 - 3, py - 2.5, plateW + 6, plateH + 5, 2.5);
    let lid: string;
    if (e.tailgate) {
      lid = roundedRect(L + 6 + lw, e.shoulder + 2, 2 * (e.halfW - 6 - lw), bumperY - 2 - e.shoulder, 2);
    } else if (style === "notch") {
      lid = P("M", L + lw + 5, ty + e.lightH * 0.6, "C", L + lw + 8, e.shoulder - 0.5, cx + e.halfW - lw - 8, e.shoulder - 0.5, cx + e.halfW - lw - 5, ty + e.lightH * 0.6);
    } else {
      // hatch / van door: the opening around the rear window, down to the bumper
      lid = symmetric(cx, [cx, bumperY - 1], [
        { L: [L + lw + 4, bumperY - 1] },
        { L: [L + lw + 4, ty + e.lightH] },
        { C: [[L + lw + 2, e.cowl], [gl + 2, e.cowl - 2], [gl + 4, e.cowl - 4]] },
        { L: [cx, e.cowl - 4] },
      ]);
    }
    const reflectors = pair(cx, [L + 6, bumperY + 3.5], [{ L: [L + 14, bumperY + 3.5] }]);
    const exhaust = roundedRect(L + e.halfW * 0.35, e.bottom - 4.5, 9, 3.2, 1.6);
    const brake = P("M", cx - 9, gTop + 1.8, "L", cx + 9, gTop + 1.8);
    details.push(plate, recess, lid, reflectors, exhaust, brake);
    if (style === "hatch" || style === "box") details.push(P("M", cx, gBase - 1, "L", cx - e.glassHalfW * 0.42, gBase - (gBase - gTop) * 0.45)); // rear wiper
  }

  return { viewBox: `0 0 ${END_BOX.w} ${END_BOX.h}`, outline, details, glass: [glassPath], lights, wheels: [] };
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
