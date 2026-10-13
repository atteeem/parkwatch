import React from "react";
import { StyleSheet, Text, useWindowDimensions, View, ViewStyle } from "react-native";
import { CAMERA_GUIDE_HINT, CAMERA_GUIDE_LABEL, CameraGuideKind, guideFrame } from "../presentation/cameraGuides";
import { GUIDE_SHAPES } from "./cameraGuides/VehicleGuides";

const CORNER = "rgba(255,255,255,0.9)";

/**
 * Framing guide drawn over the camera preview: four corner marks, a ghosted
 * line-art silhouette of the subject (front / side / rear / plate / sign), a
 * short label above and a hint below. Purely visual: it never detects or
 * checks anything, is hidden from screen readers and never takes touches, so
 * the shutter and slot buttons drawn above it keep working.
 */
export function CameraGuideOverlay({ kind }: { kind: CameraGuideKind }) {
  const { width: sw, height: sh } = useWindowDimensions();
  const { width, height } = guideFrame(kind, sw, sh);
  const Shape = GUIDE_SHAPES[kind];
  return (
    <View style={styles.fill} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <View style={{ width, height }}>
        <Corners size={Math.max(18, Math.min(28, width * 0.08))} />
        {/* shot label sits on the frame's top edge, between the corner marks (adds no height) */}
        <View style={styles.labelRow}>
          <Text style={styles.label}>{CAMERA_GUIDE_LABEL[kind]}</Text>
        </View>
        {/* the silhouette sits inside the corner marks with a little breathing room */}
        <View style={[StyleSheet.absoluteFill, { margin: Math.round(Math.min(width, height) * 0.06) }]}>
          <ScaledShape Shape={Shape} />
        </View>
      </View>
      <View style={styles.hintPill}>
        <Text style={styles.hint}>{CAMERA_GUIDE_HINT[kind]}</Text>
      </View>
    </View>
  );
}

/** Measures its box once laid out and draws the shape at that size. */
function ScaledShape({ Shape }: { Shape: (p: { W: number; H: number }) => React.ReactElement }) {
  const [size, setSize] = React.useState<{ W: number; H: number } | null>(null);
  return (
    <View style={StyleSheet.absoluteFill} onLayout={(e) => setSize({ W: e.nativeEvent.layout.width, H: e.nativeEvent.layout.height })}>
      {size && size.W > 0 && size.H > 0 ? <Shape W={size.W} H={size.H} /> : null}
    </View>
  );
}

function Corners({ size: c }: { size: number }) {
  const base: ViewStyle = { position: "absolute", width: c, height: c, borderColor: CORNER };
  const w = 2.5;
  const r = c * 0.45;
  return (
    <>
      <View style={[base, { top: 0, left: 0, borderTopWidth: w, borderLeftWidth: w, borderTopLeftRadius: r }]} />
      <View style={[base, { top: 0, right: 0, borderTopWidth: w, borderRightWidth: w, borderTopRightRadius: r }]} />
      <View style={[base, { bottom: 0, left: 0, borderBottomWidth: w, borderLeftWidth: w, borderBottomLeftRadius: r }]} />
      <View style={[base, { bottom: 0, right: 0, borderBottomWidth: w, borderRightWidth: w, borderBottomRightRadius: r }]} />
    </>
  );
}

const shadow = { textShadowColor: "rgba(0,0,0,0.55)", textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } };

const styles = StyleSheet.create({
  fill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  labelRow: { position: "absolute", top: -8, left: 0, right: 0, alignItems: "center" },
  label: { color: "rgba(255,255,255,0.92)", fontSize: 11.5, lineHeight: 15, fontWeight: "800", letterSpacing: 2, ...shadow },
  hintPill: { marginTop: 12, backgroundColor: "rgba(0,0,0,0.38)", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, maxWidth: "88%" },
  hint: { color: "rgba(255,255,255,0.95)", fontSize: 12.5, fontWeight: "600", textAlign: "center" },
});
