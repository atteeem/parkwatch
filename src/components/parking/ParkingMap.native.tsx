import React, { useEffect, useMemo, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polygon } from "react-native-maps";
import { colors } from "../../constants/colors";
import { LatLng } from "../../geo/distance";
import { initialRegion, shouldFollowCamera } from "../../map/mapLogic";
import { ParkingMapProps } from "./parkingMap.types";

// Parking map (Apple Maps on iOS, Google Maps on Android). Demo areas are
// drawn as outlines with an area-code badge; the selected one is emphasised.
// The user's position comes from the shared foreground-location store.
export function ParkingMap({
  zones,
  selectedZoneId,
  onZonePress,
  userFix,
  following,
  onUserGesture,
  recenterToken = 0,
  bottomInset = 0,
  topInset = 0,
  style,
}: ParkingMapProps) {
  const mapRef = useRef<MapView>(null);
  const lastCentered = useRef<LatLng | undefined>(undefined);
  const startRegion = useMemo(() => initialRegion(userFix, zones.map((z) => z.center)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const centerOn = (p: LatLng) => {
    lastCentered.current = { latitude: p.latitude, longitude: p.longitude };
    mapRef.current?.animateCamera({ center: lastCentered.current }, { duration: 450 });
  };

  useEffect(() => {
    if (shouldFollowCamera(following, lastCentered.current, userFix)) centerOn(userFix!);
  }, [following, userFix]);

  useEffect(() => {
    if (recenterToken > 0 && userFix) centerOn(userFix);
  }, [recenterToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // A newly selected area is brought into view (above the sheet, via mapPadding).
  const selected = zones.find((z) => z.id === selectedZoneId);
  useEffect(() => {
    if (selected) mapRef.current?.animateCamera({ center: selected.center }, { duration: 450 });
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={[styles.wrap, style]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={startRegion}
        mapPadding={{ top: topInset, right: 0, bottom: bottomInset, left: 0 }}
        pitchEnabled={false}
        toolbarEnabled={false}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsPointsOfInterests={false}
        onPanDrag={() => onUserGesture?.()}
        onRegionChangeComplete={(_r, details) => {
          if (details?.isGesture) onUserGesture?.();
        }}
      >
        {zones.map((z) => {
          const isSel = z.id === selectedZoneId;
          return (
            <Polygon
              key={`area-${z.id}-${isSel ? "s" : "n"}`}
              coordinates={[...z.boundary]}
              strokeColor={isSel ? colors.greenDark : "rgba(24,184,62,0.55)"}
              fillColor={isSel ? "rgba(92,245,138,0.38)" : "rgba(92,245,138,0.16)"}
              strokeWidth={isSel ? 3 : 1.5}
              tappable
              onPress={() => onZonePress?.(z.id)}
            />
          );
        })}
        {zones.map((z) => {
          const isSel = z.id === selectedZoneId;
          return (
            <Marker
              key={`badge-${z.id}-${isSel ? "s" : "n"}`}
              coordinate={z.center}
              onPress={() => onZonePress?.(z.id)}
              tracksViewChanges={false}
              anchor={{ x: 0.5, y: 0.5 }}
              zIndex={isSel ? 998 : 1}
              accessibilityLabel={`Area ${z.id}, ${z.name}${isSel ? ", selected" : ""}`}
            >
              <View style={[styles.badge, isSel && styles.badgeSelected]}>
                <Text style={[styles.badgeText, isSel && styles.badgeTextSelected]}>{z.id}</Text>
              </View>
            </Marker>
          );
        })}
        {userFix && (
          <Marker coordinate={userFix} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} zIndex={999}>
            <View style={styles.userDot} />
          </Marker>
        )}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: "hidden", backgroundColor: "#EAF0EC" },
  badge: {
    minWidth: 38,
    height: 30,
    paddingHorizontal: 8,
    borderRadius: 15,
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.greenDark,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeSelected: { minWidth: 48, height: 38, borderRadius: 19, backgroundColor: colors.cardBlack, borderColor: colors.white, borderWidth: 3 },
  badgeText: { fontWeight: "800", fontSize: 13, color: colors.textPrimary },
  badgeTextSelected: { color: colors.white, fontSize: 15 },
  userDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: "#3478E5", borderWidth: 3, borderColor: "#fff" },
});
