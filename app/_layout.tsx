import React from "react";
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { AppProvider } from "../src/context/AppContext";
import { ReportProvider } from "../src/context/ReportContext";
import { SessionProvider } from "../src/context/SessionContext";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <AppProvider>
          <ReportProvider>
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerShown: false }} />
          </ReportProvider>
        </AppProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
