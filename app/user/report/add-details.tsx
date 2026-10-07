import React, { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, TextInput, Image, StyleSheet, Linking, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { colors } from "../../../src/constants/colors";
import { radius } from "../../../src/constants/spacing";
import { BackHeader } from "../../../src/components/Header";
import { ReportStepper } from "../../../src/components/ReportStepper";
import { GreenButton } from "../../../src/components/GreenButton";
import { Card } from "../../../src/components/Card";
import { useReportDraft } from "../../../src/context/ReportContext";
import { VIOLATION_TYPES } from "../../../src/data/types";
import { validateDraft } from "../../../src/domain";
import { draftIssueMessages } from "../../../src/presentation/errors";
import { afterStep, draftObservedAt } from "../../../src/presentation/reportDraft";
import { LiveMap } from "../../../src/components/map/LiveMap";
import { MapLegend } from "../../../src/components/map/MapLegend";
import { useForegroundLocation } from "../../../src/location/useForegroundLocation";
import { addressNeedsTyping, GeocodeStatus, reportLocationStatus } from "../../../src/map/mapLogic";
import { reverseGeocodeAddress } from "../../../src/location/geocode";
import { expoReverseGeocoder } from "../../../src/location/expoLocationProvider";
import { LOCATION_EDUCATION, LOCATION_EDUCATION_ACTION, showLocationEducation } from "../../../src/presentation/permissionEducation";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const pad = (n: number) => String(n).padStart(2, "0");

export default function AddDetails() {
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const { draft, setLocation, setDeviceFix, selectMapPoint, resetToDeviceFix, setGeocodedAddress, setNotes, addAttachment, removeAttachment } =
    useReportDraft();
  // Foreground location while this screen is open (no background tracking).
  // The OS permission is asked from the explained "Use my location" button the
  // first time; once granted, the location is fetched automatically.
  const location = useForegroundLocation();
  const coords = draft.location.coordinates;
  const deviceFix = draft.location.deviceFix;
  const [geocode, setGeocode] = useState<GeocodeStatus>("idle");

  // Keep each new real fix as the device fix (provenance). It is also the report
  // point unless the citizen picked a point on the map.
  useEffect(() => {
    const fix = location.permission === "granted" ? location.fix : undefined;
    if (fix && fix.capturedAt !== deviceFix?.capturedAt) {
      setDeviceFix({ latitude: fix.latitude, longitude: fix.longitude, accuracyMeters: fix.accuracyMeters, capturedAt: fix.capturedAt });
    }
  }, [location.permission, location.fix]); // eslint-disable-line react-hooks/exhaustive-deps

  // Address for the current point: looked up automatically, unless the citizen typed one.
  const lookupAddress = useCallback(
    (point: { latitude: number; longitude: number }) => {
      let live = true;
      setGeocode("loading");
      void reverseGeocodeAddress(expoReverseGeocoder, point).then((r) => {
        if (!live) return;
        if (r.ok) {
          setGeocodedAddress(r.address, point);
          setGeocode("idle");
        } else {
          setGeocode("failed");
        }
      });
      return () => {
        live = false;
      };
    },
    [setGeocodedAddress]
  );
  useEffect(() => {
    if (!coords || draft.addressSource !== undefined) return;
    return lookupAddress({ latitude: coords.latitude, longitude: coords.longitude });
  }, [coords?.latitude, coords?.longitude, draft.addressSource]); // eslint-disable-line react-hooks/exhaustive-deps

  const statusInputs = {
    permission: location.permission,
    loading: location.loading,
    coordinates: coords,
    coordinatesSource: draft.location.coordinatesSource,
    addressSource: draft.addressSource,
    geocode,
  };
  const gps = reportLocationStatus(statusInputs);
  const typing = addressNeedsTyping(statusInputs);
  const canPickOnMap = Platform.OS !== "web" && !!(coords ?? deviceFix);
  const [showErrors, setShowErrors] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);

  const violationInfo = VIOLATION_TYPES.find((v) => v.id === draft.violationId);
  // observedAt: when the citizen saw the violation (device time; defaults to photo capture time).
  const observed = draftObservedAt(draft);
  const observedDate = observed ? new Date(observed) : undefined;
  const dateStr = observedDate
    ? `${pad(observedDate.getDate())}.${pad(observedDate.getMonth() + 1)}.${observedDate.getFullYear()}`
    : "—";
  const timeStr = observedDate ? `${pad(observedDate.getHours())}:${pad(observedDate.getMinutes())}` : "—";

  const issues = validateDraft(draft, "DETAILS");
  const messages = draftIssueMessages(issues);

  const handleContinue = () => {
    if (issues.length > 0) {
      setShowErrors(true); // stay here; nothing the user entered is cleared
      return;
    }
    const step = afterStep("details", from);
    if (step.kind === "backToReview") router.back();
    else router.push(step.route);
  };

  const pickAttachment = async () => {
    setAttachError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if (asset.fileSize && asset.fileSize > MAX_ATTACHMENT_BYTES) {
        setAttachError("That image is larger than 10 MB.");
        return;
      }
      // Stored as LIBRARY evidence in the attachments list, never in a required photo slot.
      addAttachment(asset.uri);
    } catch {
      setAttachError("Could not open your photo library. Please try again.");
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <BackHeader title="Report a Parking Violation" onBack={() => router.back()} />
      <ReportStepper activeStep={3} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 140, gap: 16 }}>
        <Card>
          <Text style={styles.label}>Selected issue</Text>
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.issueTitle}>{violationInfo?.label ?? "Not selected"}</Text>
              <Text style={styles.issueNote}>{violationInfo?.note}</Text>
            </View>
            <Pressable style={styles.changeBtn} onPress={() => router.push({ pathname: "/user/report/select-violation", params: from === "review" ? { from } : {} })}>
              <Text style={styles.changeLabel}>Change</Text>
            </Pressable>
          </View>
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Location</Text>
          {showLocationEducation(location.permission) ? (
            <View style={styles.educationBox}>
              <Ionicons name="navigate-circle-outline" size={20} color={colors.greenDark} />
              <View style={{ flex: 1 }}>
                <Text style={styles.educationText}>{LOCATION_EDUCATION}</Text>
                <Pressable
                  onPress={() => void location.requestPermission()}
                  style={styles.educationBtn}
                  accessibilityRole="button"
                  accessibilityHint="Asks for location permission while you use ParkWatch"
                >
                  <Text style={styles.educationBtnLabel}>{LOCATION_EDUCATION_ACTION}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          {typing ? (
            <View style={[styles.addressRow, showErrors && messages.location ? styles.addressRowError : null]}>
              <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
              <TextInput
                value={draft.location.address}
                onChangeText={setLocation}
                placeholder="Type the address"
                placeholderTextColor={colors.textLight}
                style={styles.addressInput}
                accessibilityLabel="Report address"
              />
            </View>
          ) : (
            <View style={[styles.addressRow, styles.addressRowAuto]} accessible accessibilityLabel={`Report address: ${draft.location.address || "finding the address"}`}>
              <Ionicons name="location" size={16} color={colors.greenDark} />
              <Text style={[styles.addressInput, !draft.location.address && { color: colors.textLight }]} numberOfLines={2}>
                {draft.location.address || "Finding the address…"}
              </Text>
            </View>
          )}
          {showErrors && messages.location ? <Text style={styles.errorText}>{messages.location}</Text> : null}
          <View style={styles.gpsRow}>
            <Ionicons
              name={gps.ok ? "navigate-circle" : "alert-circle-outline"}
              size={15}
              color={gps.ok ? colors.greenDark : colors.textSecondary}
            />
            <Text style={[styles.gpsText, gps.ok && { color: colors.greenDark }]}>{gps.text}</Text>
            {location.permission === "denied" ? (
              <Pressable onPress={() => void location.requestPermission()} hitSlop={6}>
                <Text style={styles.gpsAction}>Use GPS</Text>
              </Pressable>
            ) : location.permission === "blocked" && Platform.OS !== "web" ? (
              <Pressable onPress={() => void Linking.openSettings()} hitSlop={6}>
                <Text style={styles.gpsAction}>Settings</Text>
              </Pressable>
            ) : location.permission === "granted" && !coords && !location.loading ? (
              <Pressable onPress={() => void location.refreshLocation()} hitSlop={6}>
                <Text style={styles.gpsAction}>Retry</Text>
              </Pressable>
            ) : coords && geocode === "failed" && draft.addressSource !== "TYPED" ? (
              <Pressable onPress={() => lookupAddress({ latitude: coords.latitude, longitude: coords.longitude })} hitSlop={6}>
                <Text style={styles.gpsAction}>Retry</Text>
              </Pressable>
            ) : null}
          </View>
          {coords || deviceFix ? (
            <>
              <LiveMap
                style={styles.mapPreview}
                interactive={canPickOnMap}
                markers={[]}
                userFix={deviceFix?.capturedAt ? { ...deviceFix, capturedAt: deviceFix.capturedAt } : undefined}
                reportPoint={coords}
                focusPoint={coords}
                following={false}
                onMapPress={canPickOnMap ? selectMapPoint : undefined}
              />
              {coords ? <MapLegend showUser={!!deviceFix} /> : null}
              {canPickOnMap ? (
                <View style={styles.mapHintRow}>
                  <Text style={styles.mapHint}>Not quite right? Tap the map where the vehicle is.</Text>
                  {draft.location.coordinatesSource === "MAP_SELECTED" && deviceFix ? (
                    <Pressable onPress={resetToDeviceFix} hitSlop={6} accessibilityRole="button">
                      <Text style={styles.gpsAction}>Use my GPS</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </>
          ) : null}
        </Card>

        {/* Evidence provenance: the time comes from the first camera photo and is not editable. */}
        <View style={styles.observedBox} accessible accessibilityLabel={`Observed automatically ${dateStr} at ${timeStr}, from the time of the first evidence photo`}>
          <Ionicons name="camera-outline" size={18} color={colors.greenDark} />
          <View style={{ flex: 1 }}>
            <Text style={styles.observedLabel}>Observed automatically</Text>
            <Text style={styles.observedValue}>
              {dateStr} · {timeStr}
            </Text>
            <Text style={styles.observedNote}>From the time of your first evidence photo</Text>
          </View>
          <Ionicons name="lock-closed-outline" size={14} color={colors.textLight} />
        </View>

        <View>
          <Text style={styles.sectionTitle}>Additional details (optional)</Text>
          <Text style={styles.helper}>Add any extra information that can help with verification</Text>
          <TextInput
            style={styles.textarea}
            multiline
            numberOfLines={5}
            placeholder="Describe the situation..."
            placeholderTextColor={colors.textLight}
            value={draft.notes}
            onChangeText={setNotes}
          />
        </View>

        <View>
          <Text style={styles.sectionTitle}>Attachments (optional)</Text>
          <Text style={styles.helper}>Add extra photos from your library. They don't replace the three camera photos.</Text>
          {draft.attachments.length > 0 && (
            <View style={styles.attachRow}>
              {draft.attachments.map((a) => (
                <View key={a.id}>
                  <Image source={{ uri: a.uri }} style={styles.attachThumb} />
                  <Pressable style={styles.attachRemove} onPress={() => removeAttachment(a.id)} hitSlop={8}>
                    <Ionicons name="close" size={12} color="#fff" />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          <Pressable style={styles.attachBox} onPress={pickAttachment}>
            <Ionicons name="image-outline" size={18} color={colors.greenDark} />
            <Text style={styles.attachLabel}>Add photo</Text>
            <Text style={styles.attachHint}>JPG, PNG up to 10 MB</Text>
          </Pressable>
          {attachError ? <Text style={styles.errorText}>{attachError}</Text> : null}
        </View>
      </ScrollView>
      <View style={styles.bottomBar}>
        {showErrors && issues.length > 0 && !messages.location ? (
          <Text style={[styles.errorText, { marginBottom: 8 }]}>{Object.values(messages)[0]}</Text>
        ) : null}
        <GreenButton label="Continue" onPress={handleContinue} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  label: { fontSize: 12, fontWeight: "700", color: colors.textSecondary },
  issueTitle: { fontSize: 16, fontWeight: "800", marginTop: 2 },
  issueNote: { fontSize: 12.5, color: colors.textSecondary, marginTop: 2 },
  changeBtn: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.chip, paddingHorizontal: 14, paddingVertical: 8 },
  changeLabel: { fontWeight: "700", fontSize: 12.5 },
  sectionTitle: { fontSize: 16, fontWeight: "800" },
  helper: { fontSize: 12, color: colors.textSecondary, marginTop: 2, marginBottom: 8 },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 10,
  },
  addressRowError: { borderColor: colors.red },
  gpsRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  gpsText: { flex: 1, fontSize: 12, color: colors.textSecondary },
  gpsAction: { fontSize: 12.5, fontWeight: "800", color: colors.greenDark },
  addressInput: { flex: 1, fontSize: 14, color: colors.textPrimary },
  errorText: { color: "#B3261E", fontSize: 12, fontWeight: "600", marginTop: 6 },
  addressRowAuto: { backgroundColor: colors.greenLight, borderColor: colors.greenLight },
  mapPreview: { height: 180, borderRadius: radius.card, marginTop: 10 },
  mapHintRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  mapHint: { flex: 1, fontSize: 11.5, color: colors.textSecondary },
  observedBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.backgroundSunk,
  },
  observedLabel: { fontSize: 11.5, fontWeight: "700", color: colors.textSecondary },
  observedValue: { fontWeight: "800", fontSize: 15, marginTop: 1 },
  observedNote: { fontSize: 11, color: colors.textSecondary, marginTop: 1 },
  textarea: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: 14,
    minHeight: 100,
    fontSize: 14,
    color: colors.textPrimary,
    textAlignVertical: "top",
  },
  attachRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  attachThumb: { width: 60, height: 60, borderRadius: 10 },
  attachRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
  },
  attachBox: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.border,
    borderRadius: radius.card,
    paddingVertical: 22,
    alignItems: "center",
    gap: 4,
  },
  attachLabel: { color: colors.greenDark, fontWeight: "700", fontSize: 13.5 },
  attachHint: { color: colors.textLight, fontSize: 11.5 },
  educationBox: { flexDirection: "row", gap: 10, backgroundColor: colors.greenLight, borderRadius: 12, padding: 12, marginTop: 10, marginBottom: 4 },
  educationText: { fontSize: 13, lineHeight: 18, color: colors.textPrimary },
  educationBtn: { alignSelf: "flex-start", marginTop: 8, minHeight: 36, justifyContent: "center", paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.green },
  educationBtnLabel: { fontSize: 13.5, fontWeight: "800", color: "#06210F" },
  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 20, backgroundColor: colors.background },
});
