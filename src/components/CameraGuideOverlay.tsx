import React from "react";
import { StyleSheet, Text, useWindowDimensions, View, ViewStyle } from "react-native";
import { CAMERA_GUIDE_HINT, CameraGuideKind, guideFrame } from "../presentation/cameraGuides";

const LINE = "rgba(255,255,255,0.55)";
const SOFT = "rgba(255,255,255,0.32)";

/**
 * Subtle framing guide drawn over the camera preview: corner brackets plus a
 * simple outline of the subject. Purely visual: it never detects or checks
 * anything, is hidden from screen readers and never takes touches, so the
 * shutter and slot buttons drawn above it keep working.
 */
export function CameraGuideOverlay({ kind }: { kind: CameraGuideKind }) {
  const { width: sw, height: sh } = useWindowDimensions();
  const { width, height } = guideFrame(kind, sw, sh);
  return (
    <View style={styles.fill} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <View style={{ width, height }}>
        <Corners />
        <Outline kind={kind} w={width} h={height} />
      </View>
      <Text style={styles.hint}>{CAMERA_GUIDE_HINT[kind]}</Text>
    </View>
  );
}

function Corners() {
  const c = 22;
  const base: ViewStyle = { position: "absolute", width: c, height: c, borderColor: LINE };
  return (
    <>
      <View style={[base, { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 8 }]} />
      <View style={[base, { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 8 }]} />
      <View style={[base, { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 8 }]} />
      <View style={[base, { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 8 }]} />
    </>
  );
}

const box = (left: number, top: number, width: number, height: number, extra: ViewStyle = {}): ViewStyle => ({
  position: "absolute",
  left,
  top,
  width,
  height,
  borderWidth: 1.5,
  borderColor: SOFT,
  ...extra,
});

/** A simple line drawing of the subject, scaled to the frame. */
function Outline({ kind, w, h }: { kind: CameraGuideKind; w: number; h: number }) {
  if (kind === "plate") {
    return <View style={box(w * 0.04, h * 0.12, w * 0.92, h * 0.76, { borderRadius: 6 })} />;
  }
  if (kind === "sign") {
    return (
      <>
        <View style={box(w * 0.1, h * 0.04, w * 0.8, h * 0.5, { borderRadius: 6 })} />
        <View style={box(w * 0.47, h * 0.54, w * 0.06, h * 0.42, { borderRadius: 2 })} />
      </>
    );
  }
  if (kind === "vehicle-side") {
    const wheel = h * 0.34;
    return (
      <>
        {/* cabin */}
        <View style={box(w * 0.26, h * 0.12, w * 0.42, h * 0.36, { borderTopLeftRadius: h * 0.3, borderTopRightRadius: h * 0.22 })} />
        {/* body */}
        <View style={box(w * 0.05, h * 0.42, w * 0.9, h * 0.34, { borderRadius: h * 0.12 })} />
        {/* wheels */}
        <View style={box(w * 0.17, h * 0.6, wheel, wheel, { borderRadius: wheel / 2 })} />
        <View style={box(w * 0.83 - wheel, h * 0.6, wheel, wheel, { borderRadius: wheel / 2 })} />
      </>
    );
  }
  // Front or rear view: windscreen/rear window, body, lights, plate, wheels.
  const rear = kind === "vehicle-rear";
  return (
    <>
      <View style={box(w * 0.2, h * 0.1, w * 0.6, h * 0.3, { borderTopLeftRadius: h * 0.12, borderTopRightRadius: h * 0.12 })} />
      <View style={box(w * 0.08, h * 0.38, w * 0.84, h * 0.38, { borderRadius: h * 0.08 })} />
      <View style={box(w * 0.13, h * 0.46, w * 0.15, h * 0.09, { borderRadius: rear ? 3 : h * 0.05 })} />
      <View style={box(w * 0.72, h * 0.46, w * 0.15, h * 0.09, { borderRadius: rear ? 3 : h * 0.05 })} />
      <View style={box(w * 0.38, h * 0.6, w * 0.24, h * 0.1, { borderRadius: 3 })} />
      <View style={box(w * 0.12, h * 0.76, w * 0.14, h * 0.14, { borderRadius: 4 })} />
      <View style={box(w * 0.74, h * 0.76, w * 0.14, h * 0.14, { borderRadius: 4 })} />
    </>
  );
}

const styles = StyleSheet.create({
  fill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  hint: {
    marginTop: 10,
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
    fontWeight: "700",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 1 },
  },
});
