import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../../constants/colors";
import { DemoParkingZone } from "../../domain";
import { durationQuote, formatClock, hourlyRateText, VehicleView } from "../../presentation/parkingViews";
import { DemoDisclosure, FactRow, SheetCTA, SheetHeader } from "./sheetParts";

/** Final review before starting a SIMULATED session (no card, no checkout step). */
export function ParkingConfirmation({
  zone,
  vehicle,
  minutes,
  now,
  error,
  onStart,
  onBack,
  showCta = true,
}: {
  zone: DemoParkingZone;
  vehicle: VehicleView;
  minutes: number;
  now: Date;
  error?: string | null;
  onStart: () => void;
  onBack: () => void;
  showCta?: boolean;
}) {
  const q = durationQuote(minutes, now, zone.hourlyRateCents);
  return (
    <View>
      <SheetHeader title="Review" onBack={onBack} />
      <FactRow label="Area" value={`${zone.id} · ${zone.name}`} />
      <FactRow label="Vehicle" value={[vehicle.plate, vehicle.title].filter(Boolean).join(" · ")} />
      <FactRow label="Starts" value={`Now · ${formatClock(now.toISOString())}`} />
      <FactRow label="Ends" value={q.endText} />
      <FactRow label="Duration" value={q.durationText} />
      <FactRow label="Rate" value={hourlyRateText(zone.hourlyRateCents)} />
      <FactRow label="Estimated demo cost" value={q.estimateText} strong />
      <DemoDisclosure />
      {!!error && <Text style={styles.error}>{error}</Text>}
      {showCta && <SheetCTA label="Start parking" onPress={onStart} />}
    </View>
  );
}

const styles = StyleSheet.create({
  error: { color: "#B3261E", fontSize: 13, fontWeight: "600", textAlign: "center", marginTop: 12 },
});
