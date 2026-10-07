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
  selectedId,
  interactive = true,
  focusPoint,
  reportPoint,
  onMapPress,
  style,
}: LiveMapProps) {
  const mapRef = useRef<MapView>(null);
  const lastCentered = useRef<LatLng | undefined>(undefined);
  const startRegion = useMemo(() => initialRegion(focusPoint ?? userFix, markers), []); // eslint-disable-line react-hooks/exhaustive-deps

  const centerOn = (p: LatLng) => {
    lastCentered.current = { latitude: p.latitude, longitude: p.longitude };
    mapRef.current?.animateCamera({ center: lastCentered.current }, { duration: 450 });
  };

  // Follow mode: move only for meaningful position changes (no jitter).
  useEffect(() => {
    if (shouldFollowCamera(following, lastCentered.current, userFix)) centerOn(userFix!);
  }, [following, userFix]);

  // Focus a specific point (case location) when it is given or changes.
  useEffect(() => {
    if (focusPoint) centerOn(focusPoint);
  }, [focusPoint?.latitude, focusPoint?.longitude]); // eslint-disable-line react-hooks/exhaustive-deps

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
        onPress={interactive && onMapPress ? (e) => onMapPress(e.nativeEvent.coordinate) : undefined}
        onRegionChangeComplete={(_region, details) => {
          if (interactive && details?.isGesture) onUserGesture?.();
        }}
      >
        {markers.map((m) => {
          const look = MARKER_STYLE[m.kind];
          const selected = m.id === selectedId;
          return (
            <Marker
              // Re-key on selection so the custom view re-renders (tracksViewChanges stays off).
              key={`${m.id}-${selected ? "s" : "n"}`}
              coordinate={{ latitude: m.latitude, longitude: m.longitude }}
              onPress={() => onMarkerPress?.(m.id)}
              tracksViewChanges={false}
              anchor={{ x: 0.5, y: 0.5 }}
              zIndex={selected ? 998 : 1}
            >
              <View style={[styles.pin, { borderColor: look.color }, selected && [styles.pinSelected, { backgroundColor: look.color }]]}>
                <Ionicons name={look.icon} size={selected ? 18 : 14} color={selected ? "#fff" : look.color} />
              </View>
            </Marker>
          );
        })}

        {reportPoint && (
          <Marker coordinate={reportPoint} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false} zIndex={1000}>
            <Ionicons name="location" size={36} color="#D93025" />
          </Marker>
        )}

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
  pinSelected: { width: 38, height: 38, borderRadius: 19, borderWidth: 3, borderColor: "#fff" },
  userDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#3478E5",
    borderWidth: 3,
    borderColor: "#fff",
  },
});
