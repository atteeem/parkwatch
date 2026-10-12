import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { BackHandler, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { UserBottomNav, userBottomNavHeight } from "../../src/components/UserBottomNav";
import { FollowLocationButton } from "../../src/components/map/MapControls";
import { ParkingMap } from "../../src/components/parking/ParkingMap";
import { ParkingSheet } from "../../src/components/parking/ParkingSheet";
import { AreaDetail, AreaPicker } from "../../src/components/parking/AreaSteps";
import { VehiclePicker } from "../../src/components/parking/VehiclePicker";
import { DurationDial } from "../../src/components/parking/DurationStep";
import { ParkingConfirmation } from "../../src/components/parking/ParkingConfirmation";
import { ActiveParkingSummary, EndParking, ExtendParking } from "../../src/components/parking/ActiveParkingSheet";
import { SheetCTA, SheetGhost, SheetHeader } from "../../src/components/parking/sheetParts";
import { useApp } from "../../src/context/AppContext";
import { DEMO_PARKING_ZONES } from "../../src/domain";
import { haptics } from "../../src/feedback/haptics";
import { useNow } from "../../src/hooks/useNow";
import { useForegroundLocation } from "../../src/location/useForegroundLocation";
import { followReducer, INITIAL_FOLLOW_STATE } from "../../src/map/mapLogic";
import { describeDomainError } from "../../src/presentation/errors";
import { dialAccessibilityText } from "../../src/presentation/parkingDial";
import { canGoBackInFlow, highlightedZone, INITIAL_PARKING_FLOW, parkingFlowReducer } from "../../src/presentation/parkingFlow";
import { durationQuote, extensionQuote, findZone, parkingAreaRows, toActiveParkingView } from "../../src/presentation/parkingViews";
import { createSubmitGuard } from "../../src/presentation/submitGuard";

// Parking tab: one map screen. A bottom sheet walks through
// area -> vehicle -> duration -> review, and shows the running session.
// Parking is SIMULATED on this device: no operator is contacted and no
// payment is taken. Location (foreground only) is used to show where the
// user is and to sort nearby demo areas; it is not stored or sent anywhere.
export default function Parking() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { activeParking, vehicles, startParking, extendParking, endParking } = useApp();
  const [flow, dispatch] = useReducer(parkingFlowReducer, INITIAL_PARKING_FLOW);
  const now = useNow(activeParking ? 1000 : 15_000);
  const location = useForegroundLocation({ watch: true });
  const [follow, dispatchFollow] = useReducer(followReducer, INITIAL_FOLLOW_STATE);
  const [recenterToken, setRecenterToken] = useState(0);
  const [sheetHeight, setSheetHeight] = useState(240);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<"closed" | "menu" | "about">("closed");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [justStarted, setJustStarted] = useState(false);
  const pendingNewVehicle = useRef<string[] | null>(null);

  const navHeight = userBottomNavHeight(insets.bottom);
  const userFix = location.permission === "granted" ? location.fix : undefined;
  const active = activeParking ? toActiveParkingView(activeParking, now) : undefined;
  const s = flow.setup;
  const stepKey = active ? `active-${flow.active.step}` : s.step;
  // A fresh double-tap guard per step: one tap = one start/extension/end.
  const guard = useMemo(() => createSubmitGuard(), [stepKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setError(null), [stepKey]);
  useEffect(() => {
    if (!toast && !justStarted) return;
    const t = setTimeout(() => {
      setToast(null);
      setJustStarted(false);
    }, 4000);
    return () => clearTimeout(t);
  }, [toast, justStarted]);

  // Coming back from "Add vehicle": the vehicle just added is selected.
  useEffect(() => {
    const before = pendingNewVehicle.current;
    if (!before || s.step !== "SELECT_VEHICLE") return;
    const added = vehicles.find((v) => !before.includes(v.id));
    if (added) {
      pendingNewVehicle.current = null;
      dispatch({ type: "CHOOSE_VEHICLE", vehicleId: added.id });
    }
  }, [vehicles, s.step]);

  // Android Back steps back inside the sheet before it leaves the tab.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (menu !== "closed") {
          setMenu("closed");
          return true;
        }
        if (!canGoBackInFlow(flow, !!activeParking)) return false;
        dispatch({ type: "BACK" });
        return true;
      });
      return () => sub.remove();
    }, [flow, activeParking, menu])
  );

  const recenter = () => {
    if (location.permission === "blocked") {
      if (Platform.OS !== "web") void Linking.openSettings();
      return;
    }
    if (location.permission !== "granted") {
      void location.requestPermission();
      return;
    }
    dispatchFollow({ type: "RECENTER" });
    setRecenterToken((t) => t + 1);
    void location.refreshLocation();
  };

  const zone = s.step === "SELECT_AREA" ? undefined : findZone(s.zoneId);
  const defaultVehicleId = vehicles.find((v) => v.isDefault)?.id;
  const chosenVehicleId = s.step === "SELECT_VEHICLE" ? (s.vehicleId && vehicles.some((v) => v.id === s.vehicleId) ? s.vehicleId : defaultVehicleId) : undefined;

  const start = () => {
    if (s.step !== "CONFIRM") return;
    guard.run(() => startParking(s.vehicleId, s.zoneId, s.minutes), {
      onSuccess: () => {
        haptics.success("parkingChanged");
        dispatch({ type: "STARTED" });
        setJustStarted(true);
      },
      onError: (e) => setError(describeDomainError(e).message),
    });
  };

  const extend = () => {
    if (!activeParking || flow.active.step !== "EXTEND") return;
    const minutes = flow.active.minutes;
    const newEnd = extensionQuote(activeParking, minutes, now).newEndText;
    guard.run(() => extendParking(minutes), {
      onSuccess: () => {
        haptics.success("parkingChanged");
        dispatch({ type: "CLOSE_ACTIVE" });
        setToast(`Extended · now ends ${newEnd}`);
      },
      onError: (e) => setError(describeDomainError(e).message),
    });
  };

  const end = () => {
    guard.run(() => endParking(), {
      onSuccess: () => {
        haptics.success("parkingChanged");
        dispatch({ type: "ENDED" });
        setToast("Parking ended · saved to history");
      },
      onError: (e) => setError(describeDomainError(e).message),
    });
  };

  let content: React.ReactNode;
  // The main button of the taller steps is pinned under the scrolling content.
  let footer: React.ReactNode = null;
  if (active && activeParking) {
    if (flow.active.step === "EXTEND") {
      content = (
        <ExtendParking
          session={activeParking}
          minutes={flow.active.minutes}
          now={now}
          error={error}
          onChange={(m) => dispatch({ type: "SET_MINUTES", minutes: m })}
          onConfirm={extend}
          onBack={() => dispatch({ type: "BACK" })}
          showCta={false}
        />
      );
      footer = <SheetCTA label="Confirm extension" onPress={extend} />;
    } else if (flow.active.step === "END") {
      content = <EndParking view={active} error={error} onConfirm={end} onBack={() => dispatch({ type: "BACK" })} showCta={false} />;
      footer = (
        <>
          <SheetCTA label="End parking" danger onPress={end} />
          <SheetGhost label="Keep parking" onPress={() => dispatch({ type: "BACK" })} />
        </>
      );
    } else {
      content = (
        <ActiveParkingSummary
          view={active}
          justStarted={justStarted}
          notice={toast}
          onExtend={() => dispatch({ type: "OPEN_EXTEND" })}
          onEnd={() => dispatch({ type: "OPEN_END" })}
        />
      );
    }
  } else if (s.step === "SELECT_AREA" || !zone) {
    content = <AreaPicker rows={parkingAreaRows(userFix, query)} query={query} onSelect={(id) => dispatch({ type: "SELECT_ZONE", zoneId: id })} />;
  } else if (s.step === "AREA_DETAIL") {
    content = <AreaDetail zone={zone} onContinue={() => dispatch({ type: "CONTINUE", vehicleId: defaultVehicleId })} onChange={() => dispatch({ type: "BACK" })} />;
  } else if (s.step === "SELECT_VEHICLE") {
    content = (
      <VehiclePicker
        vehicles={vehicles}
        selectedId={chosenVehicleId}
        onSelect={(id) => dispatch({ type: "CHOOSE_VEHICLE", vehicleId: id })}
        onAdd={() => {
          pendingNewVehicle.current = vehicles.map((v) => v.id);
          router.push("/user/parking/add-vehicle");
        }}
        onContinue={() => dispatch({ type: "CONTINUE", vehicleId: chosenVehicleId })}
        onBack={() => dispatch({ type: "BACK" })}
      />
    );
  } else {
    const vehicle = vehicles.find((v) => v.id === s.vehicleId);
    if (!vehicle) {
      // The chosen vehicle was removed meanwhile: pick again.
      content = (
        <View>
          <SheetHeader title="Vehicle not available" subtitle="Choose the vehicle again." />
          <SheetCTA label="Choose vehicle" onPress={() => dispatch({ type: "BACK" })} />
        </View>
      );
    } else if (s.step === "SELECT_DURATION") {
      const q = durationQuote(s.minutes, now, zone.hourlyRateCents);
      content = (
        <View>
          <SheetHeader title="Parking duration" subtitle={`${zone.id} · ${zone.name} · ${vehicle.plate}`} onBack={() => dispatch({ type: "BACK" })} />
          <DurationDial
            minutes={s.minutes}
            onChange={(m) => dispatch({ type: "SET_MINUTES", minutes: m })}
            secondary={`Ends ${q.endText}`}
            centerTitle={q.estimateText}
            centerCaption="estimated demo cost"
            accessibilityLabel="Parking duration"
            accessibilityValueText={dialAccessibilityText(s.minutes, now)}
          />
        </View>
      );
      footer = (
        <SheetCTA
          label={`${q.estimateText} · Continue`}
          accessibilityHint="Estimated demo cost. Review before starting; no payment is taken."
          onPress={() => dispatch({ type: "CONTINUE" })}
        />
      );
    } else {
      content = (
        <ParkingConfirmation zone={zone} vehicle={vehicle} minutes={s.minutes} now={now} error={error} onStart={start} onBack={() => dispatch({ type: "BACK" })} showCta={false} />
      );
      footer = <SheetCTA label="Start parking" onPress={start} />;
    }
  }

  const showSearch = !active && (s.step === "SELECT_AREA" || s.step === "AREA_DETAIL");

  return (
    <View style={styles.root}>
      <ParkingMap
        style={StyleSheet.absoluteFill}
        zones={DEMO_PARKING_ZONES}
        selectedZoneId={highlightedZone(flow, activeParking?.zoneId)}
        onZonePress={active ? undefined : (id) => dispatch({ type: "SELECT_ZONE", zoneId: id })}
        userFix={userFix}
        following={follow.following && !!userFix}
        onUserGesture={() => dispatchFollow({ type: "USER_GESTURE" })}
        recenterToken={recenterToken}
        topInset={insets.top + 64}
        bottomInset={navHeight + sheetHeight}
      />

      <View style={[styles.topBar, { top: insets.top + 8 }]} pointerEvents="box-none">
        {showSearch ? (
          <View style={styles.search}>
            <Ionicons name="search" size={18} color={colors.textSecondary} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              onFocus={() => s.step === "AREA_DETAIL" && dispatch({ type: "BACK" })}
              placeholder="Search area or street"
              placeholderTextColor={colors.textLight}
              style={styles.searchInput}
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel="Search parking areas"
            />
            {!!query && (
              <Pressable onPress={() => setQuery("")} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={18} color={colors.textLight} />
              </Pressable>
            )}
          </View>
        ) : (
          <View style={styles.titlePill}>
            <Text style={styles.titlePillText}>Parking</Text>
            <Text style={styles.titlePillDemo}>Demo</Text>
          </View>
        )}
        <Pressable onPress={() => setMenu("menu")} style={styles.roundBtn} accessibilityRole="button" accessibilityLabel="Parking menu">
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.textPrimary} />
        </Pressable>
      </View>

      {!!toast && !active && (
        <View style={[styles.toast, { top: insets.top + 66 }]} accessibilityLiveRegion="polite">
          <Ionicons name="checkmark-circle" size={16} color={colors.greenDark} />
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      <View style={[styles.recenter, { bottom: navHeight + sheetHeight + 12 }]}>
        <FollowLocationButton following={follow.following && !!userFix} onPress={recenter} />
      </View>

      <ParkingSheet bottomOffset={navHeight} stepKey={stepKey} onHeight={setSheetHeight} accessibilityLabel="Parking panel" footer={footer}>
        {content}
      </ParkingSheet>

      <UserBottomNav />

      {/* Menu: an in-screen overlay (no portal/exit animation), closed before any navigation. */}
      {menu !== "closed" && (
        <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={() => setMenu("closed")} accessibilityLabel="Close menu">
          <Pressable style={[styles.menu, { marginTop: insets.top + 60 }]} onPress={() => {}}>
            {menu === "menu" ? (
              <>
                {(
                  [
                    ["car-outline", "My vehicles", () => router.push("/user/parking/vehicles")],
                    ["time-outline", "Parking history", () => router.push("/user/parking/history")],
                    ["information-circle-outline", "About demo parking", null],
                  ] as const
                ).map(([icon, label, go]) => (
                  <Pressable
                    key={label}
                    style={styles.menuRow}
                    accessibilityRole="button"
                    onPress={() => {
                      if (go) {
                        setMenu("closed");
                        go();
                      } else setMenu("about");
                    }}
                  >
                    <Ionicons name={icon} size={20} color={colors.textPrimary} />
                    <Text style={styles.menuLabel}>{label}</Text>
                  </Pressable>
                ))}
              </>
            ) : (
              <View style={{ padding: 6 }}>
                <Text style={styles.aboutTitle} accessibilityRole="header">
                  About demo parking
                </Text>
                <Text style={styles.aboutText}>
                  Parking in ParkWatch is a simulation. Sessions are stored on this device only. No parking operator is contacted and no payment is
                  taken, so a demo session is not valid parking.
                </Text>
                <Text style={styles.aboutText}>Areas, outlines and prices are illustrative demo data, not official zones or tariffs.</Text>
                <Text style={styles.aboutText}>
                  Your location is used only while this screen is open, to show where you are and sort nearby areas. It is not saved or sent.
                </Text>
                <Pressable onPress={() => setMenu("closed")} style={styles.aboutClose} accessibilityRole="button">
                  <Text style={styles.aboutCloseLabel}>Close</Text>
                </Pressable>
              </View>
            )}
          </Pressable>
        </Pressable>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#E8EFEA" },
  topBar: { position: "absolute", left: 16, right: 16, flexDirection: "row", alignItems: "center", gap: 10 },
  search: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.white,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.textPrimary, paddingVertical: 0 },
  titlePill: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  titlePillText: { fontSize: 20, fontWeight: "800", color: colors.textPrimary, backgroundColor: colors.white, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 6, overflow: "hidden" },
  titlePillDemo: { fontSize: 11.5, fontWeight: "700", color: colors.textSecondary, backgroundColor: colors.white, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden" },
  roundBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  recenter: { position: "absolute", right: 16 },
  toast: { position: "absolute", alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.white, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, elevation: 4, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  toastText: { fontSize: 13, fontWeight: "700", color: colors.textPrimary },
  backdrop: { backgroundColor: "rgba(0,0,0,0.25)", alignItems: "flex-end", paddingHorizontal: 16, zIndex: 20, elevation: 20 },
  menu: { width: 270, backgroundColor: colors.white, borderRadius: 18, paddingVertical: 6, paddingHorizontal: 6, elevation: 8, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 4 } },
  menuRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 14, minHeight: 48 },
  menuLabel: { fontSize: 15, fontWeight: "600", color: colors.textPrimary },
  aboutTitle: { fontSize: 17, fontWeight: "800", marginBottom: 8 },
  aboutText: { fontSize: 13.5, color: colors.textPrimary, lineHeight: 19, marginBottom: 8 },
  aboutClose: { alignSelf: "flex-end", paddingHorizontal: 12, paddingVertical: 10 },
  aboutCloseLabel: { fontSize: 14.5, fontWeight: "800", color: colors.greenDark },
});
