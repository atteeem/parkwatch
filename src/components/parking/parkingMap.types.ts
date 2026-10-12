import { StyleProp, ViewStyle } from "react-native";
import { DemoParkingZone } from "../../domain";
import { LocationFix } from "../../location/locationState";

export type ParkingMapProps = {
  zones: readonly DemoParkingZone[];
  /** Highlighted area (selected in the flow, or the active session's area). */
  selectedZoneId?: string;
  onZonePress?: (zoneId: string) => void;
  /** Current device position (foreground only); omitted when unavailable/denied. */
  userFix?: LocationFix;
  /** Camera follows userFix while true. */
  following: boolean;
  /** The user panned the map (turns follow off). */
  onUserGesture?: () => void;
  /** Bump to animate back to the user (Recenter). */
  recenterToken?: number;
  /** Space covered by the bottom sheet, so centred things stay visible above it. */
  bottomInset?: number;
  topInset?: number;
  style?: StyleProp<ViewStyle>;
};
