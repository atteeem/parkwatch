import React from "react";
import { View, ViewStyle } from "react-native";
import type { CameraGuideKind } from "../../presentation/cameraGuides";

// Line-art silhouettes for the camera framing guide. Drawn with plain Views
// (no SVG dependency): thin, semi-transparent white strokes plus a very faint
// body fill, so the live camera stays clearly visible. Every shape is laid
// out in fractions of the frame, so it scales with the screen.

export const GUIDE_STROKE = "rgba(255,255,255,0.62)";
export const GUIDE_DETAIL = "rgba(255,255,255,0.38)";
export const GUIDE_FILL = "rgba(255,255,255,0.05)";
const MAIN = 1.5;
const THIN = 1;

type Box = { l: number; t: number; w: number; h: number };

/** Absolute shape in frame fractions. */
function shape(W: number, H: number, b: Box, style: ViewStyle = {}): ViewStyle {
  return { position: "absolute", left: W * b.l, top: H * b.t, width: W * b.w, height: H * b.h, ...style };
}

const stroke = (width = MAIN, color = GUIDE_STROKE): ViewStyle => ({ borderWidth: width, borderColor: color });
const detail = (): ViewStyle => stroke(THIN, GUIDE_DETAIL);

/** A thin straight line (horizontal when h ~ 0, vertical when w ~ 0). */
function Line({ W, H, b, color = GUIDE_DETAIL, weight = THIN }: { W: number; H: number; b: Box; color?: string; weight?: number }) {
  const horizontal = b.w >= b.h;
  return (
    <View
      style={shape(W, H, b, horizontal ? { height: weight, backgroundColor: color, borderRadius: weight } : { width: weight, backgroundColor: color, borderRadius: weight })}
    />
  );
}

/**
 * A window drawn as a trapezoid (narrower at the top), made by tilting a
 * rounded rectangle away from the viewer.
 */
function Glass({ W, H, b, tilt = 38, inner = false }: { W: number; H: number; b: Box; tilt?: number; inner?: boolean }) {
  return (
    <View
      style={shape(W, H, b, {
        ...(inner ? detail() : stroke()),
        backgroundColor: inner ? "transparent" : GUIDE_FILL,
        borderRadius: H * 0.05,
        transform: [{ perspective: 600 }, { rotateX: `${tilt}deg` }],
      })}
    />
  );
}

/** Stubby tyres under a front/rear body, plus a faint ground line. */
function TyresAndGround({ W, H }: { W: number; H: number }) {
  const tyre = (l: number) => (
    <View
      style={shape(W, H, { l, t: 0.76, w: 0.17, h: 0.09 }, { ...stroke(), borderTopWidth: 0, backgroundColor: GUIDE_FILL, borderBottomLeftRadius: H * 0.04, borderBottomRightRadius: H * 0.04 })}
    />
  );
  return (
    <>
      {tyre(0.11)}
      {tyre(0.72)}
      <Line W={W} H={H} b={{ l: 0, t: 0.88, w: 1, h: 0 }} color="rgba(255,255,255,0.18)" />
    </>
  );
}

/** Front view: windscreen, wide body, headlights, grille, plate, mirrors and tyres. */
export function FrontGuide({ W, H }: { W: number; H: number }) {
  return (
    <>
      <TyresAndGround W={W} H={H} />
      {/* roof + pillars, windscreen inside */}
      <Glass W={W} H={H} b={{ l: 0.17, t: 0.05, w: 0.66, h: 0.4 }} />
      <Glass W={W} H={H} b={{ l: 0.23, t: 0.12, w: 0.54, h: 0.29 }} inner />
      {/* mirrors */}
      <View style={shape(W, H, { l: 0.08, t: 0.36, w: 0.08, h: 0.06 }, { ...detail(), borderRadius: 6 })} />
      <View style={shape(W, H, { l: 0.84, t: 0.36, w: 0.08, h: 0.06 }, { ...detail(), borderRadius: 6 })} />
      {/* body */}
      <View
        style={shape(W, H, { l: 0.05, t: 0.4, w: 0.9, h: 0.36 }, { ...stroke(), backgroundColor: GUIDE_FILL, borderTopLeftRadius: H * 0.12, borderTopRightRadius: H * 0.12, borderBottomLeftRadius: H * 0.07, borderBottomRightRadius: H * 0.07 })}
      />
      {/* headlights */}
      <View style={shape(W, H, { l: 0.1, t: 0.47, w: 0.18, h: 0.07 }, { ...detail(), borderRadius: H * 0.035, borderTopLeftRadius: H * 0.06 })} />
      <View style={shape(W, H, { l: 0.72, t: 0.47, w: 0.18, h: 0.07 }, { ...detail(), borderRadius: H * 0.035, borderTopRightRadius: H * 0.06 })} />
      {/* grille */}
      <View style={shape(W, H, { l: 0.34, t: 0.49, w: 0.32, h: 0.08 }, { ...detail(), borderRadius: H * 0.03 })} />
      {/* plate */}
      <View style={shape(W, H, { l: 0.41, t: 0.63, w: 0.18, h: 0.07 }, { ...detail(), borderRadius: 3 })} />
      {/* bumper crease */}
      <Line W={W} H={H} b={{ l: 0.12, t: 0.6, w: 0.22, h: 0 }} />
      <Line W={W} H={H} b={{ l: 0.66, t: 0.6, w: 0.22, h: 0 }} />
    </>
  );
}

/** Rear view: rear window, boot line, tail lights at the corners, plate, bumper line, tyres. No grille. */
export function RearGuide({ W, H }: { W: number; H: number }) {
  return (
    <>
      <TyresAndGround W={W} H={H} />
      {/* roof + C-pillars, rear window inside (smaller and higher than a windscreen) */}
      <Glass W={W} H={H} b={{ l: 0.19, t: 0.06, w: 0.62, h: 0.36 }} tilt={30} />
      <Glass W={W} H={H} b={{ l: 0.27, t: 0.13, w: 0.46, h: 0.22 }} tilt={30} inner />
      {/* body */}
      <View
        style={shape(W, H, { l: 0.05, t: 0.38, w: 0.9, h: 0.38 }, { ...stroke(), backgroundColor: GUIDE_FILL, borderTopLeftRadius: H * 0.1, borderTopRightRadius: H * 0.1, borderBottomLeftRadius: H * 0.07, borderBottomRightRadius: H * 0.07 })}
      />
      {/* boot lid line */}
      <Line W={W} H={H} b={{ l: 0.22, t: 0.46, w: 0.56, h: 0 }} />
      {/* tail lights, wrapping the outer corners */}
      <View style={shape(W, H, { l: 0.07, t: 0.44, w: 0.15, h: 0.1 }, { ...detail(), borderRadius: 3, borderTopLeftRadius: H * 0.07 })} />
      <View style={shape(W, H, { l: 0.78, t: 0.44, w: 0.15, h: 0.1 }, { ...detail(), borderRadius: 3, borderTopRightRadius: H * 0.07 })} />
      {/* plate recess */}
      <View style={shape(W, H, { l: 0.39, t: 0.52, w: 0.22, h: 0.09 }, { ...detail(), borderRadius: 4 })} />
      {/* bumper line */}
      <Line W={W} H={H} b={{ l: 0.1, t: 0.66, w: 0.8, h: 0 }} />
    </>
  );
}

/** Side profile (front to the left): long body, sloped windscreen, cabin with pillar, two wheels. */
export function SideGuide({ W, H }: { W: number; H: number }) {
  const wheel = 0.34; // of H
  const wheelW = (wheel * H) / W;
  const frontWheelL = 0.14;
  const rearWheelL = 0.86 - wheelW;
  const sill = 0.74;
  return (
    <>
      {/* cabin: sloped windscreen (left) and rear window (right) */}
      <View
        style={shape(W, H, { l: 0.21, t: 0.12, w: 0.6, h: 0.31 }, { ...stroke(), borderBottomWidth: 0, backgroundColor: GUIDE_FILL, borderTopLeftRadius: H * 0.3, borderTopRightRadius: H * 0.24 })}
      />
      {/* side windows + B-pillar */}
      <View style={shape(W, H, { l: 0.27, t: 0.18, w: 0.215, h: 0.24 }, { ...detail(), borderBottomWidth: 0, borderTopLeftRadius: H * 0.22, borderTopRightRadius: 2 })} />
      <View style={shape(W, H, { l: 0.505, t: 0.18, w: 0.24, h: 0.24 }, { ...detail(), borderBottomWidth: 0, borderTopRightRadius: H * 0.18, borderTopLeftRadius: 2 })} />
      {/* body: top and ends; the sill is drawn in pieces so no line runs through the wheels */}
      <View
        style={shape(W, H, { l: 0.03, t: 0.42, w: 0.94, h: sill - 0.42 }, { ...stroke(), borderBottomWidth: 0, backgroundColor: GUIDE_FILL, borderTopLeftRadius: H * 0.18, borderTopRightRadius: H * 0.12 })}
      />
      <Line W={W} H={H} b={{ l: 0.03, t: sill, w: frontWheelL - 0.03 - 0.01, h: 0 }} color={GUIDE_STROKE} weight={MAIN} />
      <Line W={W} H={H} b={{ l: frontWheelL + wheelW + 0.01, t: sill, w: rearWheelL - frontWheelL - wheelW - 0.02, h: 0 }} color={GUIDE_STROKE} weight={MAIN} />
      <Line W={W} H={H} b={{ l: rearWheelL + wheelW + 0.01, t: sill, w: 0.97 - rearWheelL - wheelW - 0.01, h: 0 }} color={GUIDE_STROKE} weight={MAIN} />
      {/* door line and handles */}
      <Line W={W} H={H} b={{ l: 0.495, t: 0.44, w: 0, h: 0.26 }} />
      <Line W={W} H={H} b={{ l: 0.38, t: 0.5, w: 0.05, h: 0 }} weight={2} />
      <Line W={W} H={H} b={{ l: 0.58, t: 0.5, w: 0.05, h: 0 }} weight={2} />
      {/* head / tail light hints */}
      <View style={shape(W, H, { l: 0.035, t: 0.47, w: 0.05, h: 0.07 }, { ...detail(), borderRadius: 4 })} />
      <View style={shape(W, H, { l: 0.915, t: 0.47, w: 0.05, h: 0.08 }, { ...detail(), borderRadius: 3 })} />
      {/* wheels: tyre + hub */}
      {[frontWheelL, rearWheelL].map((l) => (
        <React.Fragment key={l}>
          <View style={shape(W, H, { l, t: sill - wheel / 2, w: wheelW, h: wheel }, { ...stroke(), borderRadius: (wheel * H) / 2 })} />
          <View
            style={shape(W, H, { l: l + wheelW * 0.3, t: sill - wheel / 2 + wheel * 0.3, w: wheelW * 0.4, h: wheel * 0.4 }, { ...detail(), borderRadius: (wheel * H) / 2 })}
          />
        </React.Fragment>
      ))}
      {/* ground */}
      <Line W={W} H={H} b={{ l: 0.0, t: sill + wheel / 2 + 0.02, w: 1, h: 0 }} color="rgba(255,255,255,0.18)" />
    </>
  );
}

/** Licence plate (officer): one plate outline with a faint fill. */
export function PlateGuide({ W, H }: { W: number; H: number }) {
  return (
    <>
      <View style={shape(W, H, { l: 0.04, t: 0.14, w: 0.92, h: 0.72 }, { ...stroke(), backgroundColor: GUIDE_FILL, borderRadius: 8 })} />
      <View style={shape(W, H, { l: 0.07, t: 0.26, w: 0.07, h: 0.48 }, { ...detail(), borderRadius: 3 })} />
    </>
  );
}

/** Parking sign (officer): sign panel on a post. */
export function SignGuide({ W, H }: { W: number; H: number }) {
  return (
    <>
      <View style={shape(W, H, { l: 0.1, t: 0.04, w: 0.8, h: 0.5 }, { ...stroke(), backgroundColor: GUIDE_FILL, borderRadius: 8 })} />
      <View style={shape(W, H, { l: 0.2, t: 0.6, w: 0.6, h: 0.12 }, { ...detail(), borderRadius: 4 })} />
      <View style={shape(W, H, { l: 0.475, t: 0.72, w: 0.05, h: 0.26 }, { ...detail(), borderRadius: 2 })} />
    </>
  );
}

export const GUIDE_SHAPES: Record<CameraGuideKind, (p: { W: number; H: number }) => React.ReactElement> = {
  "vehicle-front": FrontGuide,
  "vehicle-side": SideGuide,
  "vehicle-rear": RearGuide,
  plate: PlateGuide,
  sign: SignGuide,
};
