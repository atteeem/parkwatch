import React from "react";
import Svg, { Circle, Path } from "react-native-svg";
import { VehicleGuideProfile, VehicleView, vehicleDrawing } from "../../presentation/vehicleGuideGeometry";

// One vehicle silhouette (profile x view) as thin line art. Every line is
// drawn twice: a soft dark under-stroke first, then the white stroke on top,
// so the outline stays visible on bright daylight scenes too. The body has
// only a whisper of fill: the live camera stays dominant.

export const GUIDE_LINE = "rgba(255,255,255,0.95)";
export const GUIDE_DETAIL = "rgba(255,255,255,0.6)";
export const GUIDE_SHADOW = "rgba(0,0,0,0.35)";
export const GUIDE_FILL = "rgba(255,255,255,0.05)";
export const OUTLINE_WIDTH = 2;
export const DETAIL_WIDTH = 1.3;
const SHADOW_EXTRA = 1.6;

export function VehicleGuide({ profile, view, width, height }: { profile: VehicleGuideProfile; view: VehicleView; width: number; height: number }) {
  const d = vehicleDrawing(profile, view);
  const common = { vectorEffect: "non-scaling-stroke" as const, strokeLinejoin: "round" as const, strokeLinecap: "round" as const, fill: "none" };
  return (
    <Svg width={width} height={height} viewBox={d.viewBox} preserveAspectRatio="xMidYMid meet" testID={`guide-${profile}-${view}`}>
      {/* under-strokes for contrast */}
      {[d.outline, ...d.details].map((p, i) => (
        <Path key={`s${i}`} d={p} stroke={GUIDE_SHADOW} strokeWidth={OUTLINE_WIDTH + SHADOW_EXTRA} {...common} />
      ))}
      {d.wheels.map((w, i) => (
        <Circle key={`sw${i}`} cx={w.cx} cy={w.cy} r={w.r} stroke={GUIDE_SHADOW} strokeWidth={OUTLINE_WIDTH + SHADOW_EXTRA} {...common} />
      ))}
      {/* exterior outline: strongest line */}
      <Path d={d.outline} stroke={GUIDE_LINE} strokeWidth={OUTLINE_WIDTH} {...common} fill={GUIDE_FILL} />
      {/* inner details: softer */}
      {d.details.map((p, i) => (
        <Path key={`d${i}`} d={p} stroke={GUIDE_DETAIL} strokeWidth={DETAIL_WIDTH} {...common} />
      ))}
      {d.wheels.map((w, i) => (
        <React.Fragment key={`w${i}`}>
          <Circle cx={w.cx} cy={w.cy} r={w.r} stroke={GUIDE_LINE} strokeWidth={OUTLINE_WIDTH} {...common} />
          <Circle cx={w.cx} cy={w.cy} r={w.r * 0.45} stroke={GUIDE_DETAIL} strokeWidth={DETAIL_WIDTH} {...common} />
        </React.Fragment>
      ))}
    </Svg>
  );
}
