// Expo Location adapter: FOREGROUND APIs only. No background location,
// geofencing or activity recognition is ever requested.
import * as Location from "expo-location";
import { LocationProvider } from "./locationStore";
import { PermissionResponse } from "./locationState";

const toPermission = (r: Location.LocationPermissionResponse): PermissionResponse => ({
  status: r.status === Location.PermissionStatus.GRANTED ? "granted" : r.status === Location.PermissionStatus.DENIED ? "denied" : "undetermined",
  canAskAgain: r.canAskAgain,
});

export const expoLocationProvider: LocationProvider = {
  getPermission: async () => toPermission(await Location.getForegroundPermissionsAsync()),
  requestPermission: async () => toPermission(await Location.requestForegroundPermissionsAsync()),
  getCurrentPosition: () => Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
  watchPosition: async (onPosition, onError) => {
    const sub = await Location.watchPositionAsync(
      // Small movements are ignored to avoid jittery map updates.
      { accuracy: Location.Accuracy.High, distanceInterval: 5, timeInterval: 3000 },
      onPosition,
      (reason) => onError(reason)
    );
    return () => sub.remove();
  },
};
