import React from "react";
import { StyleSheet, Text, useWindowDimensions, View, ViewStyle } from "react-native";
import { CAMERA_GUIDE_HINT, CAMERA_GUIDE_LABEL, CameraGuideKind, GUIDE_VIEW, guideFrame, guideFrameInArea, guideIsCompact } from "../presentation/cameraGuides";
import type { VehicleGuideProfile } from "../presentation/vehicleGuideGeometry";
import { VehicleGuide } from "./cameraGuides/VehicleGuide";
import { PlateTarget, SignTarget } from "./cameraGuides/OfficerGuides";
import { LevelIndicator } from "./cameraGuides/LevelIndicator";
import { useDeviceLevel } from "../sensors/useDeviceLevel";

const CORNER = "rgba(255,255,255,0.9)";

/**
 * Framing guide over the camera preview: corner marks, the subject's line-art
 * silhouette (vehicle type x front / side / rear, or a plate / sign target),
 * the shot label on the frame's top edge, a phone-level line and a hint.
 * Purely visual: nothing is detected or checked, it is hidden from screen
 * readers and never takes touches, so the controls drawn above keep working.
 *
 * `area` = the free space between the instruction card and the photo slots
 * (measured by the camera screen); the frame is sized to fit inside it.
 */
export function CameraGuideOverlay({
  kind,
  profile = "GENERIC",
  area,
  showLevel = true,
}: {
  kind: CameraGuideKind;
  profile?: VehicleGuideProfile;
  area?: { y: number; height: number };
  showLevel?: boolean;
}) {
  const { width: sw, height: sh } = useWindowDimensions();
  const level = useDeviceLevel(showLevel);
  const { width, height } = area ? guideFrameInArea(kind, sw, area.height) : guideFrame(kind, sw, sh);
  const view = GUIDE_VIEW[kind];
  const compact = !!area && guideIsCompact(area.height);
  const pad = Math.round(Math.min(width, height) * 0.04);
  const inner = { width: width - 2 * pad, height: height - 2 * pad };
  const box: ViewStyle = area ? { position: "absolute", left: 0, right: 0, top: area.y, height: area.height } : { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 };

  return (
    <View style={[box, styles.center]} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <View style={{ width, height }}>
        <Corners size={Math.max(18, Math.min(28, width * 0.08))} />
        <View style={styles.labelRow}>
          <Text style={styles.label}>{CAMERA_GUIDE_LABEL[kind]}</Text>
        </View>
        <View style={[StyleSheet.absoluteFill, { padding: pad, alignItems: "center", justifyContent: "center" }]}>
          {view ? (
            <VehicleGuide profile={profile} view={view} width={inner.width} height={inner.height} />
          ) : kind === "plate" ? (
            <PlateTarget width={inner.width} height={inner.height} />
          ) : (
            <SignTarget width={inner.width} height={inner.height} />
          )}
        </View>
      </View>
      <View style={styles.below}>
        {showLevel ? <LevelIndicator level={level} /> : null}
        {compact ? null : (
          <View style={styles.hintPill}>
            <Text style={styles.hint}>{CAMERA_GUIDE_HINT[kind]}</Text>
          </View>
        )}
      </View>
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
  center: { alignItems: "center", justifyContent: "center" },
  labelRow: { position: "absolute", top: -8, left: 0, right: 0, alignItems: "center" },
  label: { color: "rgba(255,255,255,0.92)", fontSize: 11.5, lineHeight: 15, fontWeight: "800", letterSpacing: 2, ...shadow },
  below: { alignSelf: "stretch", alignItems: "center", marginTop: 8, gap: 6 },
  hintPill: { backgroundColor: "rgba(0,0,0,0.42)", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, maxWidth: "88%" },
  hint: { color: "rgba(255,255,255,0.95)", fontSize: 12.5, fontWeight: "600", textAlign: "center" },
});
