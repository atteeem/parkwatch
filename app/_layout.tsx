import React from "react";
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { AppProvider } from "../src/context/AppContext";
import { ReportProvider } from "../src/context/ReportContext";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <ReportProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false }} />
        </ReportProvider>
      </AppProvider>
    </SafeAreaProvider>
  );
}
