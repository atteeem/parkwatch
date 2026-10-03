import React, { useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import MapView, { Circle, Marker } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import { initialRegion, shouldFollowCamera } from "../../map/mapLogic";
import { LatLng } from "../../geo/distance";
import { LiveMapProps, MARKER_STYLE } from "./liveMap.types";

// Real interactive map (Apple Maps on iOS, Google Maps on Android).
// The user's position comes from our shared foreground-location store, not
// the map's own tracking, so there is one source of truth for GPS.
export function LiveMap({
  markers,
  userFix,
  following,
  onUserGesture,
  recenterToken = 0,
  onMarkerPress,
  interactive = true,
  style,
}: LiveMapProps) {
  const mapRef = useRef<MapView>(null);
  const lastCentered = useRef<LatLng | undefined>(undefined);
  const startRegion = useMemo(() => initialRegion(userFix, markers), []); // eslint-disable-line react-hooks/exhaustive-deps

  const centerOn = (p: LatLng) => {
    lastCentered.current = { latitude: p.latitude, longitude: p.longitude };
    mapRef.current?.animateCamera({ center: lastCentered.current }, { duration: 450 });
  };

  // Follow mode: move only for meaningful position changes (no jitter).
  useEffect(() => {
    if (shouldFollowCamera(following, lastCentered.current, userFix)) centerOn(userFix!);
  }, [following, userFix]);

  // Explicit Recenter always moves, even for a small offset.
  useEffect(() => {
    if (recenterToken > 0 && userFix) centerOn(userFix);
  }, [recenterToken]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={[styles.wrap, style]} pointerEvents={interactive ? "auto" : "none"}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={startRegion}
        scrollEnabled={interactive}
        zoomEnabled={interactive}
        rotateEnabled={interactive}
        pitchEnabled={false}
        toolbarEnabled={false}
        showsUserLocation={false}
        showsMyLocationButton={false}
        onPanDrag={interactive ? () => onUserGesture?.() : undefined}
        onRegionChangeComplete={(_region, details) => {
          if (interactive && details?.isGesture) onUserGesture?.();
        }}
      >
        {markers.map((m) => {
          const look = MARKER_STYLE[m.kind];
          return (
            <Marker
              key={m.id}
              coordinate={{ latitude: m.latitude, longitude: m.longitude }}
              onPress={() => onMarkerPress?.(m.id)}
              tracksViewChanges={false}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View style={[styles.pin, { borderColor: look.color }]}>
                <Ionicons name={look.icon} size={14} color={look.color} />
              </View>
            </Marker>
          );
        })}

        {userFix && (
          <>
            {userFix.accuracyMeters !== undefined && userFix.accuracyMeters > 0 && (
              <Circle
                center={userFix}
                radius={userFix.accuracyMeters}
                strokeColor="rgba(52,120,229,0.35)"
                fillColor="rgba(52,120,229,0.12)"
              />
            )}
            <Marker coordinate={userFix} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} zIndex={999}>
              <View style={styles.userDot} />
            </Marker>
          </>
        )}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: "hidden", backgroundColor: "#EAF0EC" },
  pin: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#fff",
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  userDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#3478E5",
    borderWidth: 3,
    borderColor: "#fff",
  },
});
