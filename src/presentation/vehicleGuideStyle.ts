// How a vehicle guide is painted (pure): an ordered list of SVG path layers.
// Shared by the camera overlay (VehicleGuide.tsx) and the design preview
// (scripts/guide-gallery.mjs), so the preview is exactly what the camera shows.
//
// Style: thin semi-transparent white lines with a soft dark under-stroke (so
// they read on bright daylight and on dark scenes), a whisper of ghost fill
// on the body, a faint tint on glass and lights. The live camera stays dominant.

import type { GuideDrawing } from "./vehicleGuideGeometry";

export const GUIDE_LINE = "rgba(255,255,255,0.92)";
export const GUIDE_DETAIL = "rgba(255,255,255,0.66)";
export const GUIDE_SHADOW = "rgba(0,0,0,0.34)";
export const GUIDE_SHADOW_SOFT = "rgba(0,0,0,0.28)";
export const GUIDE_FILL = "rgba(255,255,255,0.06)";
export const GUIDE_GLASS_FILL = "rgba(190,215,255,0.10)";
export const GUIDE_LIGHT_FILL = "rgba(255,255,255,0.14)";
export const GUIDE_LIGHT_LINE = "rgba(255,255,255,0.82)";
export const GUIDE_TYRE_FILL = "rgba(0,0,0,0.14)";
export const OUTLINE_WIDTH = 1.7;
export const DETAIL_WIDTH = 1;
const SHADOW_EXTRA = 1.5;

export type GuideLayer = { key: string; d: string; stroke: string; strokeWidth: number; fill: string };

const circle = (cx: number, cy: number, r: number) => `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;

function spokes(cx: number, cy: number, r: number): string {
  const out: string[] = [];
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    const x0 = cx + Math.cos(a) * r * 0.26;
    const y0 = cy + Math.sin(a) * r * 0.26;
    const x1 = cx + Math.cos(a) * r * 0.64;
    const y1 = cy + Math.sin(a) * r * 0.64;
    out.push(`M ${x0.toFixed(1)} ${y0.toFixed(1)} L ${x1.toFixed(1)} ${y1.toFixed(1)}`);
  }
  return out.join(" ");
}

export function guideLayers(d: GuideDrawing): GuideLayer[] {
  const L: GuideLayer[] = [];
  const add = (key: string, path: string, stroke: string, strokeWidth: number, fill = "none") => L.push({ key, d: path, stroke, strokeWidth, fill });

  // 1. ghost fills (no stroke): body, then glass and tyres on top
  add("body-fill", d.outline, "none", 0, GUIDE_FILL);
  d.glass.forEach((g, i) => add(`glass-fill-${i}`, g, "none", 0, GUIDE_GLASS_FILL));
  d.wheels.forEach((w, i) => add(`tyre-fill-${i}`, circle(w.cx, w.cy, w.r), "none", 0, GUIDE_TYRE_FILL));

  // 2. dark under-strokes for contrast on bright scenes
  add("outline-shadow", d.outline, GUIDE_SHADOW, OUTLINE_WIDTH + SHADOW_EXTRA);
  d.wheels.forEach((w, i) => add(`tyre-shadow-${i}`, circle(w.cx, w.cy, w.r), GUIDE_SHADOW, OUTLINE_WIDTH + SHADOW_EXTRA));
  [...d.glass, ...d.details, ...d.lights].forEach((p, i) => add(`soft-shadow-${i}`, p, GUIDE_SHADOW_SOFT, DETAIL_WIDTH + 1.1));

  // 3. lines: exterior strongest, inner details soft, lights a little brighter
  add("outline", d.outline, GUIDE_LINE, OUTLINE_WIDTH);
  d.glass.forEach((g, i) => add(`glass-${i}`, g, GUIDE_DETAIL, DETAIL_WIDTH));
  d.details.forEach((p, i) => add(`detail-${i}`, p, GUIDE_DETAIL, DETAIL_WIDTH));
  d.lights.forEach((p, i) => add(`light-${i}`, p, GUIDE_LIGHT_LINE, DETAIL_WIDTH, GUIDE_LIGHT_FILL));
  d.wheels.forEach((w, i) => {
    add(`tyre-${i}`, circle(w.cx, w.cy, w.r), GUIDE_LINE, OUTLINE_WIDTH);
    add(`rim-${i}`, circle(w.cx, w.cy, w.r * 0.68), GUIDE_DETAIL, DETAIL_WIDTH);
    add(`spokes-${i}`, spokes(w.cx, w.cy, w.r), GUIDE_DETAIL, DETAIL_WIDTH * 0.9);
    add(`hub-${i}`, circle(w.cx, w.cy, w.r * 0.18), GUIDE_DETAIL, DETAIL_WIDTH);
  });
  return L;
}
