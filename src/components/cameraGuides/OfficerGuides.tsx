import React from "react";
import Svg, { Path, Rect } from "react-native-svg";
import { GUIDE_DETAIL, GUIDE_FILL, GUIDE_LINE, GUIDE_SHADOW, OUTLINE_WIDTH, DETAIL_WIDTH } from "./VehicleGuide";

// Officer-only framing targets (licence plate, parking sign), in the same line style.

const stroke = { vectorEffect: "non-scaling-stroke" as const, strokeLinejoin: "round" as const, fill: "none" };

/** A plate-proportioned target (EU / Finnish plate ~ 4.7 : 1) with a country band hint. */
export function PlateTarget({ width, height }: { width: number; height: number }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 470 110" preserveAspectRatio="xMidYMid meet" testID="guide-plate">
      <Rect x={4} y={4} width={462} height={102} rx={10} stroke={GUIDE_SHADOW} strokeWidth={OUTLINE_WIDTH + 1.6} {...stroke} />
      <Rect x={4} y={4} width={462} height={102} rx={10} stroke={GUIDE_LINE} strokeWidth={OUTLINE_WIDTH} {...stroke} fill={GUIDE_FILL} />
      <Path d="M 46 12 L 46 98" stroke={GUIDE_DETAIL} strokeWidth={DETAIL_WIDTH} {...stroke} />
    </Svg>
  );
}

/** Parking sign panel on a post, with an additional-plate hint. */
export function SignTarget({ width, height }: { width: number; height: number }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 100 140" preserveAspectRatio="xMidYMid meet" testID="guide-sign">
      {[0, 1].map((k) => (
        <React.Fragment key={k}>
          <Rect x={14} y={4} width={72} height={64} rx={6} stroke={k ? GUIDE_LINE : GUIDE_SHADOW} strokeWidth={k ? OUTLINE_WIDTH : OUTLINE_WIDTH + 1.6} {...stroke} fill={k ? GUIDE_FILL : "none"} />
          <Rect x={22} y={74} width={56} height={16} rx={3} stroke={k ? GUIDE_DETAIL : GUIDE_SHADOW} strokeWidth={DETAIL_WIDTH} {...stroke} />
          <Path d="M 50 90 L 50 136" stroke={k ? GUIDE_DETAIL : GUIDE_SHADOW} strokeWidth={DETAIL_WIDTH + 1} {...stroke} />
        </React.Fragment>
      ))}
    </Svg>
  );
}
