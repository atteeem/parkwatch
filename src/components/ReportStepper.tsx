import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../constants/colors";

const STAGES: { label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { label: "Take Photos", icon: "camera" },
  { label: "Select Violation", icon: "document-text" },
  { label: "Add Details", icon: "document-text" },
  { label: "Review & Submit", icon: "checkmark-done" },
];

export function ReportStepper({ activeStep }: { activeStep: number }) {
  return (
    <View style={styles.row}>
      {STAGES.map((stage, i) => {
        const stepNum = i + 1;
        const done = stepNum <= activeStep;
        return (
          <React.Fragment key={stage.label}>
            <View style={styles.stageCol}>
              <View style={[styles.circle, done ? styles.circleDone : styles.circleTodo]}>
                <Ionicons name={stage.icon} size={16} color={done ? "#06210F" : colors.textLight} />
              </View>
              <Text style={[styles.label, done && styles.labelDone]} numberOfLines={1}>
                {stage.label}
              </Text>
            </View>
            {stepNum < STAGES.length && (
              <View style={[styles.connector, stepNum < activeStep ? styles.connectorDone : styles.connectorTodo]} />
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  stageCol: {
    alignItems: "center",
    width: 68,
  },
  circle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  circleDone: { backgroundColor: colors.green },
  circleTodo: { backgroundColor: colors.backgroundSunk },
  label: {
    fontSize: 10.5,
    fontWeight: "600",
    color: colors.textLight,
    marginTop: 4,
    textAlign: "center",
  },
  labelDone: { color: colors.greenDark },
  connector: {
    flex: 1,
    height: 2,
    marginTop: 17,
    marginHorizontal: -6,
  },
  connectorDone: { backgroundColor: colors.green },
  connectorTodo: { backgroundColor: colors.border },
});
