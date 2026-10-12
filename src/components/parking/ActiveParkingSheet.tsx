import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../constants/colors";
import { ParkingSession } from "../../domain";
import { dialAccessibilityText, DEFAULT_DIAL_RANGE } from "../../presentation/parkingDial";
import { ActiveParkingView, extensionQuote } from "../../presentation/parkingViews";
import { DurationDial } from "./DurationStep";
import { DemoDisclosure, FactRow, SheetCTA, SheetGhost, SheetHeader, ZoneBadge } from "./sheetParts";

/** The running session: big remaining time, progress, and Extend / End. */
export function ActiveParkingSummary({
  view,
  justStarted,
  notice,
  onExtend,
  onEnd,
}: {
  view: ActiveParkingView;
  justStarted?: boolean;
  notice?: string | null;
  onExtend: () => void;
  onEnd: () => void;
}) {
  return (
    <View>
      {(justStarted || notice) && (
        <View style={styles.started} accessibilityLiveRegion="polite">
          <Ionicons name="checkmark-circle" size={18} color={colors.greenDark} />
          <Text style={styles.startedText}>{notice ?? "Parking started"}</Text>
        </View>
      )}
      <View style={styles.top}>
        <View style={[styles.livePill, view.expired && styles.livePillExpired]}>
          <View style={[styles.liveDot, view.expired && { backgroundColor: colors.red }]} />
          <Text style={[styles.liveText, view.expired && { color: "#B3261E" }]}>{view.expired ? "Time is up" : "Active parking"}</Text>
        </View>
        <Text style={styles.demo}>Demo</Text>
      </View>
      <View style={styles.row}>
        <ZoneBadge code={view.zoneId} large />
        <View style={{ flex: 1 }}>
          <Text style={styles.plate}>{view.plate}</Text>
          <Text style={styles.area}>{view.areaName}</Text>
        </View>
      </View>
      <Text style={styles.remaining} accessibilityLabel={view.expired ? "Planned parking time has ended" : `${view.remainingText} remaining`}>
        {view.expired ? "00:00" : view.remainingText}
      </Text>
      <Text style={styles.remainingLabel}>{view.expired ? "planned time has ended" : "remaining"}</Text>
      <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(view.progress * 100) }}>
        <View style={[styles.fill, { width: `${Math.round(view.progress * 100)}%` }, view.expired && { backgroundColor: colors.red }]} />
      </View>
      <FactRow label="Ends at" value={view.endText} />
      <FactRow label="Parked" value={view.elapsedText} />
      <FactRow label="Current demo cost" value={view.currentCostText} strong />
      <View style={styles.actions}>
        <Pressable onPress={onExtend} style={({ pressed }) => [styles.extend, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel="Extend parking">
          <Ionicons name="time-outline" size={18} color={colors.white} />
          <Text style={styles.extendLabel}>Extend</Text>
        </Pressable>
        <Pressable onPress={onEnd} style={({ pressed }) => [styles.end, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel="End parking">
          <Text style={styles.endLabel}>End parking</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Extension with the same dial: current end → new end, added time, estimate for the whole session. */
export function ExtendParking({
  session,
  minutes,
  now,
  error,
  onChange,
  onConfirm,
  onBack,
  showCta = true,
}: {
  session: ParkingSession;
  minutes: number;
  now: Date;
  error?: string | null;
  onChange: (m: number) => void;
  onConfirm: () => void;
  onBack: () => void;
  showCta?: boolean;
}) {
  const q = extensionQuote(session, minutes, now);
  return (
    <View>
      <SheetHeader title="Extend parking" onBack={onBack} />
      <DurationDial
        minutes={minutes}
        onChange={onChange}
        range={DEFAULT_DIAL_RANGE}
        headlinePrefix="+"
        secondary={`Ends ${q.newEndText} instead of ${q.currentEndText}`}
        centerTitle={q.totalEstimateText}
        centerCaption="estimated demo cost"
        accessibilityLabel="Time to add"
        accessibilityValueText={`${dialAccessibilityText(minutes, now).split(",")[0]} added, new end ${q.newEndText}`}
      />
      {/* Added time, current -> new end and the estimate are all shown above (headline, end line, dial centre). */}
      <DemoDisclosure compact />
      {!!error && <Text style={styles.error}>{error}</Text>}
      {showCta && <SheetCTA label="Confirm extension" onPress={onConfirm} />}
    </View>
  );
}

/** Confirmation before ending. */
export function EndParking({
  view,
  error,
  onConfirm,
  onBack,
  showCta = true,
}: {
  view: ActiveParkingView;
  error?: string | null;
  onConfirm: () => void;
  onBack: () => void;
  showCta?: boolean;
}) {
  return (
    <View>
      <SheetHeader title="End parking?" onBack={onBack} backLabel="Keep parking" />
      <FactRow label="Vehicle" value={view.plate} />
      <FactRow label="Area" value={`${view.zoneId} · ${view.areaName}`} />
      <FactRow label="Time parked" value={view.elapsedText} />
      <FactRow label="Final demo cost" value={view.currentCostText} strong />
      <DemoDisclosure compact />
      {!!error && <Text style={styles.error}>{error}</Text>}
      {showCta && <SheetCTA label="End parking" danger onPress={onConfirm} />}
      {showCta && <SheetGhost label="Keep parking" onPress={onBack} />}
    </View>
  );
}

const styles = StyleSheet.create({
  started: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.greenLight, borderRadius: 12, padding: 10, marginBottom: 12 },
  startedText: { fontSize: 13.5, fontWeight: "700", color: colors.greenDark, flex: 1 },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  livePill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.greenLight, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  livePillExpired: { backgroundColor: colors.redLight },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.greenDark },
  liveText: { fontSize: 12.5, fontWeight: "800", color: colors.greenDark },
  demo: { fontSize: 11.5, fontWeight: "700", color: colors.textSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 14 },
  plate: { fontSize: 20, fontWeight: "800", letterSpacing: 0.5, color: colors.textPrimary },
  area: { fontSize: 13.5, color: colors.textSecondary, marginTop: 2 },
  remaining: { fontSize: 44, fontWeight: "800", textAlign: "center", marginTop: 18, color: colors.textPrimary, fontVariant: ["tabular-nums"] },
  remainingLabel: { fontSize: 13, color: colors.textSecondary, textAlign: "center" },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.backgroundSunk, overflow: "hidden", marginTop: 14, marginBottom: 6 },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.green },
  actions: { flexDirection: "row", gap: 10, marginTop: 16 },
  extend: { flex: 1, minHeight: 54, borderRadius: 16, backgroundColor: colors.cardBlack, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  extendLabel: { color: colors.white, fontWeight: "800", fontSize: 15.5 },
  end: { flex: 1, minHeight: 54, borderRadius: 16, backgroundColor: colors.redLight, alignItems: "center", justifyContent: "center" },
  endLabel: { color: "#B3261E", fontWeight: "800", fontSize: 15.5 },
  error: { color: "#B3261E", fontSize: 13, fontWeight: "600", textAlign: "center", marginTop: 12 },
});
