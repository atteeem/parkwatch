// DEVELOPMENT ONLY: side-by-side preview of the camera framing guides.
// Renders every vehicle guide (7 body types x front / side / rear) with the
// SAME geometry and paint layers the app uses, over bright, mid-tone and dark
// "camera" backgrounds at phone size. With --compare <file.ts>, an older
// vehicleGuideGeometry.ts is drawn next to it in the previous style.
//
//   node scripts/guide-gallery.mjs <out.html> [--compare old-geometry.ts]

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2] ?? "guide-gallery.html";
const cmpIdx = process.argv.indexOf("--compare");
const geo = await import(pathToFileURL(join(root, "src/presentation/vehicleGuideGeometry.ts")).href);
const style = await import(pathToFileURL(join(root, "src/presentation/vehicleGuideStyle.ts")).href);
const old = cmpIdx > 0 ? await import(pathToFileURL(resolve(process.argv[cmpIdx + 1])).href) : null;

const SCENES = {
  bright: "linear-gradient(180deg,#cfd8dc 0%,#e9eef0 45%,#9aa3a7 46%,#b9c0c3 100%)",
  street: "linear-gradient(180deg,#58687a 0%,#7d8b97 48%,#3d4247 49%,#55595d 100%)",
  night: "linear-gradient(180deg,#0b0f17 0%,#1b2330 48%,#121417 49%,#1e2023 100%)",
};
// Frame sizes as on a 390 pt wide phone (guideFrameInArea for a ~430 pt free area).
const SCALE = Number((process.argv.find((a) => a.startsWith("--scale=")) ?? "--scale=1").slice(8)) || 1;
const FRAME = Object.fromEntries(Object.entries({ FRONT: [335, 251], SIDE: [370, 154], REAR: [335, 251] }).map(([k, [w, h]]) => [k, [Math.round(w * SCALE), Math.round(h * SCALE)]]));

const attrs = (o) => Object.entries(o).map(([k, v]) => `${k}="${v}"`).join(" ");
const common = 'vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"';

function newSvg(d, w, h) {
  const paths = style.guideLayers(d).map((l) => `<path ${attrs({ d: l.d, stroke: l.stroke, "stroke-width": l.strokeWidth, fill: l.fill })} ${common}/>`).join("");
  return `<svg width="${w}" height="${h}" viewBox="${d.viewBox}" preserveAspectRatio="xMidYMid meet">${paths}</svg>`;
}

// The previous renderer (before T9.4), for comparison.
function oldSvg(d, w, h) {
  const p = [];
  for (const s of [d.outline, ...d.details]) p.push(`<path d="${s}" stroke="rgba(0,0,0,0.35)" stroke-width="3.6" fill="none" ${common}/>`);
  for (const c of d.wheels) p.push(`<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}" stroke="rgba(0,0,0,0.35)" stroke-width="3.6" fill="none" ${common}/>`);
  p.push(`<path d="${d.outline}" stroke="rgba(255,255,255,0.95)" stroke-width="2" fill="rgba(255,255,255,0.05)" ${common}/>`);
  for (const s of d.details) p.push(`<path d="${s}" stroke="rgba(255,255,255,0.6)" stroke-width="1.3" fill="none" ${common}/>`);
  for (const c of d.wheels) p.push(`<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}" stroke="rgba(255,255,255,0.95)" stroke-width="2" fill="none" ${common}/><circle cx="${c.cx}" cy="${c.cy}" r="${c.r * 0.45}" stroke="rgba(255,255,255,0.6)" stroke-width="1.3" fill="none" ${common}/>`);
  return `<svg width="${w}" height="${h}" viewBox="${d.viewBox}" preserveAspectRatio="xMidYMid meet">${p.join("")}</svg>`;
}

function frame(svg, view, scene, label) {
  const [w, h] = FRAME[view];
  const pad = Math.round(Math.min(w, h) * 0.04);
  const c = Math.max(18, Math.min(28, w * 0.08));
  const corner = (pos) => `<div class="c ${pos}" style="width:${c}px;height:${c}px"></div>`;
  return `<div class="scene" style="background:${SCENES[scene]}"><div class="frame" style="width:${w}px;height:${h}px">${["tl", "tr", "bl", "br"].map(corner).join("")}<div class="lab">${label}</div><div class="in" style="padding:${pad}px">${svg.replace(/width="\d+" height="\d+"/, `width="${w - 2 * pad}" height="${h - 2 * pad}"`)}</div></div></div>`;
}

const profiles = ["GENERIC", ...geo.VEHICLE_GUIDE_PROFILES];
let html = `<!doctype html><meta charset="utf-8"><title>Vehicle guides</title><style>
body{margin:0;padding:16px;background:#202124;color:#eee;font:13px system-ui,sans-serif}
h2{margin:22px 0 8px;font-size:15px} .row{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start}
.cell{display:flex;flex-direction:column;gap:4px} .cap{font-size:11px;color:#aaa}
.scene{width:${Math.round(390 * SCALE)}px;height:${Math.round(300 * SCALE)}px;display:flex;align-items:center;justify-content:center;border-radius:10px;overflow:hidden}
.frame{position:relative} .in{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.c{position:absolute;border-color:rgba(255,255,255,.9);border-style:solid;border-width:0}
.tl{top:0;left:0;border-top-width:2.5px;border-left-width:2.5px;border-top-left-radius:11px}
.tr{top:0;right:0;border-top-width:2.5px;border-right-width:2.5px;border-top-right-radius:11px}
.bl{bottom:0;left:0;border-bottom-width:2.5px;border-left-width:2.5px;border-bottom-left-radius:11px}
.br{bottom:0;right:0;border-bottom-width:2.5px;border-right-width:2.5px;border-bottom-right-radius:11px}
.lab{position:absolute;top:-8px;left:0;right:0;text-align:center;font-size:11.5px;font-weight:800;letter-spacing:2px;color:rgba(255,255,255,.92);text-shadow:0 1px 4px rgba(0,0,0,.55)}
</style>`;

// 1. Old vs new, all three views of the default (officer + "Not sure") car, on all scenes
for (const view of ["FRONT", "SIDE", "REAR"]) {
  html += `<h2>GENERIC ${view} - ${old ? "before (left) vs after (right)" : "after"} on bright / street / night</h2><div class="row">`;
  for (const scene of Object.keys(SCENES)) {
    if (old) html += `<div class="cell"><div class="cap">before · ${scene}</div>${frame(oldSvg(old.vehicleDrawing("GENERIC", view), ...FRAME[view]), view, scene, view)}</div>`;
    html += `<div class="cell"><div class="cap">after · ${scene}</div>${frame(newSvg(geo.vehicleDrawing("GENERIC", view), ...FRAME[view]), view, scene, view)}</div>`;
  }
  html += `</div>`;
}
// 2. Every body type, new style, street scene: front / side / rear as one family
for (const p of profiles) {
  html += `<h2>${p} - front / side / rear${old ? " (before row above after row)" : ""}</h2>`;
  if (old) html += `<div class="row">${["FRONT", "SIDE", "REAR"].map((v) => `<div class="cell"><div class="cap">before</div>${frame(oldSvg(old.vehicleDrawing(p, v), ...FRAME[v]), v, "street", v)}</div>`).join("")}</div>`;
  html += `<div class="row">${["FRONT", "SIDE", "REAR"].map((v) => `<div class="cell"><div class="cap">after</div>${frame(newSvg(geo.vehicleDrawing(p, v), ...FRAME[v]), v, "street", v)}</div>`).join("")}</div>`;
}
writeFileSync(out, html);
console.log(`wrote ${out}`);
