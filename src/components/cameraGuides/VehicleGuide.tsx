import React from "react";
import Svg, { Path } from "react-native-svg";
import { VehicleGuideProfile, VehicleView, vehicleDrawing } from "../../presentation/vehicleGuideGeometry";
import { guideLayers } from "../../presentation/vehicleGuideStyle";

// One vehicle silhouette (profile x view) as layered line art; the layers and
// colours come from presentation/vehicleGuideStyle (shared with the design
// preview). Purely visual.

export { GUIDE_DETAIL, GUIDE_FILL, GUIDE_LINE, GUIDE_SHADOW, OUTLINE_WIDTH, DETAIL_WIDTH } from "../../presentation/vehicleGuideStyle";

export function VehicleGuide({ profile, view, width, height }: { profile: VehicleGuideProfile; view: VehicleView; width: number; height: number }) {
  const d = vehicleDrawing(profile, view);
  const layers = guideLayers(d);
  return (
    <Svg width={width} height={height} viewBox={d.viewBox} preserveAspectRatio="xMidYMid meet" testID={`guide-${profile}-${view}`}>
      {layers.map((l) => (
        <Path
          key={l.key}
          d={l.d}
          stroke={l.stroke}
          strokeWidth={l.strokeWidth}
          fill={l.fill}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
    </Svg>
  );
}
