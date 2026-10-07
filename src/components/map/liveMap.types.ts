import { StyleProp, ViewStyle } from "react-native";
import { LocationFix } from "../../location/locationState";
import { MapMarker, MarkerKind } from "../../map/mapLogic";
import { colors } from "../../constants/colors";

export type LiveMapProps = {
  markers: MapMarker[];
  /** Current device position (foreground); omitted when unavailable/denied. */
  userFix?: LocationFix;
  /** Follow mode: camera follows userFix while true. */
  following: boolean;
  /** Called when the user pans/drags the map (turns follow mode off). */
  onUserGesture?: () => void;
  /** Bump this number to animate back to the user (Recenter). */
  recenterToken?: number;
  onMarkerPress?: (id: string) => void;
  /** Marker drawn as selected (larger, filled) — e.g. the case shown in the preview sheet. */
  selectedId?: string;
  /** Center the camera on this point (e.g. a case opened from "Open in Maps"). Takes precedence over the user position for the starting view. */
  focusPoint?: { latitude: number; longitude: number };
  /** The report point (a pin, distinct from the user's blue dot). */
  reportPoint?: { latitude: number; longitude: number };
  /** Tap on the map (native only; the web preview has no map to tap). */
  onMapPress?: (point: { latitude: number; longitude: number }) => void;
  /** false = static preview (no gestures). */
  interactive?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Marker look per kind (shared by native and web). */
export const MARKER_STYLE: Record<MarkerKind, { color: string; icon: "checkmark" | "time" | "close" | "alert" | "car" }> = {
  verified: { color: colors.greenDark, icon: "checkmark" },
  "under-review": { color: "#B47A00", icon: "time" },
  rejected: { color: colors.red, icon: "close" },
  "case-new": { color: colors.greenDark, icon: "car" },
  "case-active": { color: colors.amber, icon: "car" },
  "case-high": { color: colors.red, icon: "alert" },
};
