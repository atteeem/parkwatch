import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, Modal, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/constants/colors";
import { typography } from "../../src/constants/typography";
import { radius, shadow, BOTTOM_NAV_HEIGHT } from "../../src/constants/spacing";
import { UserBottomNav } from "../../src/components/UserBottomNav";
import { GreenButton } from "../../src/components/GreenButton";
import { Card } from "../../src/components/Card";
import { ConfirmDialog } from "../../src/components/ConfirmDialog";
import { useApp } from "../../src/context/AppContext";
import { useNow } from "../../src/hooks/useNow";
import { describeDomainError } from "../../src/presentation/errors";
import { PARKING_EXTENSION_PRESETS, toActiveParkingView } from "../../src/presentation/parkingViews";

// Parking tab. Sessions are SIMULATED on this device: no parking operator is
// contacted and nothing is paid. The active card is derived from the stored
// session and the current time (no hardcoded timer).
export default function Parking() {
  const router = useRouter();
  const { activeParking, vehicles, extendParking, endParking } = useApp();
  const now = useNow(1000, !!activeParking);
  const active = activeParking ? toActiveParkingView(activeParking, now) : undefined;
  const [extendOpen, setExtendOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startParking = () => {
    if (active) {
      setNotice("Parking is already active. Extend or end it below.");
      return;
    }
    router.push("/user/parking/start");
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
        <Text style={typography.screenTitle}>Parking</Text>
        <Text style={typography.screenSubtitle}>Manage your parking sessions and charges</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: BOTTOM_NAV_HEIGHT + 20, gap: 16 }}>
        <View style={styles.previewBanner}>
          <Ionicons name="information-circle-outline" size={16} color={colors.blue} />
          <Text style={styles.previewText}>
            Demo parking: sessions run on this phone only and no payment is taken. Parking charges below are examples.
          </Text>
        </View>

        {notice && (
          <Pressable style={styles.notice} onPress={() => setNotice(null)}>
            <Ionicons name="information-circle" size={16} color={colors.greenDark} />
            <Text style={styles.noticeText}>{notice}</Text>
          </Pressable>
        )}
        {error && (
          <Pressable style={styles.errorBanner} onPress={() => setError(null)}>
            <Ionicons name="alert-circle" size={16} color="#B3261E" />
            <Text style={styles.errorText}>{error}</Text>
          </Pressable>
        )}

        {active ? (
          <Card dark>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={styles.pCircle}>
                  <Text style={{ fontWeight: "800", color: "#06210F", fontSize: 16 }}>P</Text>
                </View>
                <Text style={styles.darkTitle}>Active Parking</Text>
              </View>
              <View style={[styles.timer, active.expired && { borderColor: colors.red }]} accessibilityLabel={`${active.remainingText} left`}>
                <Text style={styles.timerText}>{active.expired ? "00:00" : active.remainingText}</Text>
                <Text style={[styles.timerLabel, active.expired && { color: "#FFB4AB" }]}>{active.expired ? "expired" : "left"}</Text>
              </View>
            </View>
            <Text style={styles.plate}>{active.plate}</Text>
            <Text style={styles.darkSub}>
              <Ionicons name="location" size={11} color="#B9C1BB" /> {active.location}
            </Text>
            <Text style={styles.zone}>{active.zone}</Text>
            <View style={styles.timesRow}>
              <View>
                <Text style={styles.costLabel}>Started</Text>
                <Text style={styles.timeValue}>{active.startText}</Text>
              </View>
              <View>
                <Text style={styles.costLabel}>Ends</Text>
                <Text style={styles.timeValue}>{active.endText}</Text>
              </View>
              <View>
                <Text style={styles.costLabel}>Parked</Text>
                <Text style={styles.timeValue}>{active.elapsedText}</Text>
              </View>
            </View>
            <Text style={styles.costLabel}>Current cost (demo rate)</Text>
            <Text style={styles.cost}>{active.currentCostText}</Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
              <Pressable style={styles.darkBtnOutline} onPress={() => setExtendOpen(true)} accessibilityRole="button">
                <Ionicons name="time-outline" size={15} color="#fff" />
                <Text style={styles.darkBtnOutlineLabel}>Extend</Text>
              </Pressable>
              <Pressable style={styles.darkBtnSolid} onPress={() => setConfirmEnd(true)} accessibilityRole="button">
                <Ionicons name="square-outline" size={15} color={colors.red} />
                <Text style={styles.darkBtnSolidLabel}>End Parking</Text>
              </Pressable>
            </View>
          </Card>
        ) : (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <Text style={{ fontWeight: "800", color: colors.greenDark, fontSize: 18 }}>P</Text>
            </View>
            <Text style={styles.emptyTitle}>No active parking</Text>
            <Text style={styles.emptyBody}>Choose a vehicle, zone and duration to start a parking session.</Text>
            <GreenButton label="Start Parking" small onPress={startParking} style={{ marginTop: 12, alignSelf: "stretch" }} />
          </View>
        )}

        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable style={styles.quickAction} onPress={startParking} accessibilityRole="button">
            <Ionicons name="pricetag-outline" size={20} color={colors.greenDark} />
            <Text style={styles.quickActionLabel}>Start Parking</Text>
          </Pressable>
          <Pressable style={styles.quickAction} onPress={() => router.push("/user/parking/vehicles")} accessibilityRole="button">
            <Ionicons name="car-outline" size={20} color={colors.greenDark} />
            <Text style={styles.quickActionLabel}>My Vehicles</Text>
          </Pressable>
          <Pressable style={styles.quickAction} onPress={() => router.push("/user/parking/history")} accessibilityRole="button">
            <Ionicons name="time-outline" size={20} color={colors.greenDark} />
            <Text style={styles.quickActionLabel}>Parking History</Text>
          </Pressable>
        </View>

        <View>
          <Text style={typography.sectionHeading}>Parking Charges</Text>
          <Text style={styles.examplesNote}>Examples only. Operator charges are not connected yet.</Text>
          <Card style={{ marginTop: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={styles.unpaidChip}><Text style={styles.unpaidChipLabel}>Unpaid</Text></View>
              <View style={styles.providerChip}><Text style={styles.providerChipLabel}>P</Text></View>
              <Text style={{ fontWeight: "700", fontSize: 13 }}>Parking operator</Text>
              <Text style={{ marginLeft: "auto", fontWeight: "800", fontSize: 17 }}>{"€60.00"}</Text>
            </View>
            <Text style={styles.chargeMeta}>
              <Ionicons name="car" size={12} /> JSK-306
            </Text>
            <Text style={styles.chargeMeta}>
              <Ionicons name="information-circle-outline" size={12} /> No valid parking payment found
            </Text>
            <Text style={styles.dueText}>Due Jul 30</Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <GreenButton label="Pay Now" small style={{ flex: 1 }} disabled />
              <GreenButton label="View Details" small variant="outline" style={{ flex: 1 }} disabled />
            </View>
          </Card>
          <Card style={{ marginTop: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={styles.paidChip}><Text style={styles.paidChipLabel}>Paid</Text></View>
              <View style={[styles.providerChip, { backgroundColor: "#12140F" }]}><Text style={styles.providerChipLabel}>A</Text></View>
              <Text style={{ fontWeight: "700", fontSize: 13 }}>Parking operator</Text>
              <Text style={{ marginLeft: "auto", fontWeight: "800", fontSize: 17 }}>{"€5.00"}</Text>
            </View>
            <Text style={styles.chargeMeta}>
              <Ionicons name="car" size={12} /> JSK-306
            </Text>
            <Text style={[styles.dueText, { color: colors.greenDark }]}>Paid Jul 27</Text>
          </Card>
        </View>

        <View>
          <Text style={typography.sectionHeading}>Registered Vehicles</Text>
          {vehicles.length === 0 && <Text style={styles.examplesNote}>No vehicles yet.</Text>}
          {vehicles.map((v) => (
            <Pressable key={v.id} style={styles.vehicleRow} onPress={() => router.push("/user/parking/vehicles")}>
              <Ionicons name="car" size={20} color={colors.textSecondary} />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={{ fontWeight: "800", fontSize: 14.5 }}>{v.plate}</Text>
                {!!v.title && <Text style={{ fontSize: 12, color: colors.textSecondary }}>{v.title}</Text>}
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textLight} />
            </Pressable>
          ))}
          <Pressable style={styles.addVehicle} onPress={() => router.push("/user/parking/add-vehicle")}>
            <Ionicons name="add-circle-outline" size={18} color={colors.greenDark} />
            <Text style={styles.addVehicleLabel}>Add vehicle</Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal visible={extendOpen} transparent animationType="fade" onRequestClose={() => setExtendOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setExtendOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Extend parking</Text>
            <Text style={styles.sheetBody}>
              {active ? `Currently ends at ${active.endText}.` : ""} Choose how much time to add.
            </Text>
            <View style={styles.sheetOptions}>
              {PARKING_EXTENSION_PRESETS.map((p) => (
                <Pressable
                  key={p.minutes}
                  style={styles.sheetOption}
                  accessibilityRole="button"
                  onPress={() => {
                    const r = extendParking(p.minutes);
                    setExtendOpen(false);
                    if (r.ok) setNotice(`Parking extended by ${p.label.replace("+", "")}.`);
                    else setError(describeDomainError(r.error).message);
                  }}
                >
                  <Text style={styles.sheetOptionLabel}>{p.label}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable onPress={() => setExtendOpen(false)} style={{ alignItems: "center", marginTop: 14 }}>
              <Text style={{ color: colors.textSecondary, fontWeight: "700" }}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <ConfirmDialog
        visible={confirmEnd}
        title="End parking?"
        message={active ? `${active.plate} has been parked for ${active.elapsedText}. Current cost at the demo rate: ${active.currentCostText}.` : ""}
        confirmLabel="End Parking"
        destructive
        onCancel={() => setConfirmEnd(false)}
        onConfirm={() => {
          const r = endParking();
          setConfirmEnd(false);
          if (r.ok) setNotice("Parking ended. You can find it in Parking History.");
          else setError(describeDomainError(r.error).message);
        }}
      />
      <UserBottomNav />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.greenLight, borderRadius: radius.card, padding: 12 },
  noticeText: { flex: 1, fontSize: 12.5, color: colors.greenDark, fontWeight: "600" },
  errorBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.redLight, borderRadius: radius.card, padding: 12 },
  errorText: { flex: 1, fontSize: 12.5, color: "#B3261E", fontWeight: "600" },
  timesRow: { flexDirection: "row", gap: 24 },
  timeValue: { color: "#fff", fontWeight: "700", fontSize: 14, marginTop: 2 },
  emptyCard: { alignItems: "center", backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 20, ...shadow.card },
  emptyIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.greenLight, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontWeight: "800", fontSize: 16, marginTop: 10 },
  emptyBody: { fontSize: 12.5, color: colors.textSecondary, textAlign: "center", marginTop: 4 },
  examplesNote: { fontSize: 11.5, color: colors.textLight, marginTop: 4 },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32 },
  sheetTitle: { fontSize: 18, fontWeight: "800" },
  sheetBody: { fontSize: 13, color: colors.textSecondary, marginTop: 4 },
  sheetOptions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 16 },
  sheetOption: { flexBasis: "47%", flexGrow: 1, borderWidth: 1.5, borderColor: colors.green, borderRadius: radius.button, paddingVertical: 14, alignItems: "center" },
  sheetOptionLabel: { fontWeight: "800", fontSize: 14, color: colors.greenDark },
  previewBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.blueLight, borderRadius: radius.card, padding: 12 },
  previewText: { flex: 1, fontSize: 12, color: colors.textPrimary, lineHeight: 16 },
  safe: { flex: 1, backgroundColor: colors.background },
  pCircle: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.green, alignItems: "center", justifyContent: "center" },
  darkTitle: { color: "#fff", fontWeight: "800", fontSize: 17 },
  timer: { width: 76, height: 76, borderRadius: 38, borderWidth: 3, borderColor: "#fff", alignItems: "center", justifyContent: "center" },
  timerText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  timerLabel: { color: "#B9C1BB", fontSize: 9 },
  plate: { color: "#fff", fontWeight: "800", fontSize: 20, marginTop: 16 },
  darkSub: { color: "#B9C1BB", fontSize: 12.5, marginTop: 4 },
  zone: { color: colors.green, fontWeight: "700", fontSize: 12.5, marginTop: 6 },
  costLabel: { color: "#B9C1BB", fontSize: 11.5, marginTop: 14 },
  cost: { color: "#fff", fontWeight: "800", fontSize: 22, marginTop: 2 },
  darkBtnOutline: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#fff", borderRadius: radius.chip, paddingVertical: 12 },
  darkBtnOutlineLabel: { color: "#fff", fontWeight: "700", fontSize: 13 },
  darkBtnSolid: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", backgroundColor: "#fff", borderRadius: radius.chip, paddingVertical: 12 },
  darkBtnSolidLabel: { color: colors.red, fontWeight: "700", fontSize: 13 },
  quickAction: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, alignItems: "center", justifyContent: "center", paddingVertical: 18, gap: 8 },
  quickActionLabel: { fontWeight: "700", fontSize: 12, textAlign: "center" },
  unpaidChip: { backgroundColor: colors.redLight, borderRadius: radius.chip, paddingHorizontal: 10, paddingVertical: 3 },
  unpaidChipLabel: { color: colors.red, fontWeight: "700", fontSize: 11 },
  paidChip: { backgroundColor: colors.greenLight, borderRadius: radius.chip, paddingHorizontal: 10, paddingVertical: 3 },
  paidChipLabel: { color: colors.greenDark, fontWeight: "700", fontSize: 11 },
  providerChip: { width: 20, height: 20, borderRadius: 6, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center" },
  providerChipLabel: { color: "#fff", fontWeight: "800", fontSize: 11 },
  chargeMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 6 },
  dueText: { fontSize: 11.5, fontWeight: "700", color: colors.red, marginTop: 4 },
  vehicleRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 14, marginTop: 10 },
  addVehicle: { flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: colors.green, borderStyle: "dashed", borderRadius: radius.card, paddingVertical: 14, marginTop: 10 },
  addVehicleLabel: { color: colors.greenDark, fontWeight: "700" },
});
