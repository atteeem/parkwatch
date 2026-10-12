import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../constants/colors";
import { DemoParkingZone } from "../../domain";
import { ParkingAreaRow, parkingAreaDetail } from "../../presentation/parkingViews";
import { SheetCTA, SheetGhost, SheetHeader, ZoneBadge } from "./sheetParts";

/** "Select area": nearest demo areas first (straight-line distance only when the position is known). */
export function AreaPicker({ rows, onSelect, query }: { rows: ParkingAreaRow[]; onSelect: (zoneId: string) => void; query: string }) {
  return (
    <View>
      <SheetHeader title="Select area" subtitle="Tap an area on the map or below" />
      {rows.length === 0 && <Text style={styles.empty}>No demo area matches “{query.trim()}”.</Text>}
      {rows.map((r, i) => (
        <Pressable
          key={r.id}
          onPress={() => onSelect(r.id)}
          style={({ pressed }) => [styles.row, i > 0 && styles.rowDivider, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel={`Area ${r.id}, ${r.name}, ${r.rateText}${r.distanceText ? `, ${r.distanceText} away in a straight line` : ""}`}
        >
          <ZoneBadge code={r.id} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{r.name}</Text>
            <Text style={styles.meta}>{[r.distanceText, r.location].filter(Boolean).join(" · ")}</Text>
          </View>
          <Text style={styles.rate}>{r.rateText}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textLight} />
        </Pressable>
      ))}
    </View>
  );
}

/** Selected area: code, name, demo rate and the facts that apply. */
export function AreaDetail({ zone, onContinue, onChange }: { zone: DemoParkingZone; onContinue: () => void; onChange: () => void }) {
  const d = parkingAreaDetail(zone);
  return (
    <View>
      <View style={styles.detailHead}>
        <ZoneBadge code={d.id} large />
        <View style={{ flex: 1 }}>
          <Text style={styles.detailName} accessibilityRole="header">
            {d.name}
          </Text>
          <Text style={styles.meta}>{d.location}</Text>
        </View>
      </View>
      <Text style={styles.price}>{d.rateText}</Text>
      <View style={styles.facts}>
        {[
          ["time-outline", d.pricingText],
          ["hourglass-outline", d.maxText],
          ["map-outline", d.sourceText],
        ].map(([icon, text]) => (
          <View key={text} style={styles.fact}>
            <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={16} color={colors.textSecondary} />
            <Text style={styles.factText}>{text}</Text>
          </View>
        ))}
      </View>
      <SheetCTA label="Continue" onPress={onContinue} />
      <SheetGhost label="Change area" onPress={onChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, minHeight: 60 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight },
  name: { fontSize: 15.5, fontWeight: "700", color: colors.textPrimary },
  meta: { fontSize: 12.5, color: colors.textSecondary, marginTop: 2 },
  rate: { fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  empty: { fontSize: 13.5, color: colors.textSecondary, paddingVertical: 12 },
  detailHead: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 4 },
  detailName: { fontSize: 22, fontWeight: "800", color: colors.textPrimary },
  price: { fontSize: 30, fontWeight: "800", color: colors.textPrimary, marginTop: 18 },
  facts: { marginTop: 8, gap: 8 },
  fact: { flexDirection: "row", alignItems: "center", gap: 8 },
  factText: { fontSize: 13.5, color: colors.textSecondary, flex: 1 },
});
