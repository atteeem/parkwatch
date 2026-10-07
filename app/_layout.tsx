import React from "react";
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "../src/auth/AuthContext";
import { AppProvider } from "../src/context/AppContext";
import { ReportProvider } from "../src/context/ReportContext";
import { SessionProvider } from "../src/context/SessionContext";
import { AvatarProvider } from "../src/auth/AvatarContext";

// AuthProvider: identity (Supabase account in backend mode; nothing in local demo).
// SessionProvider: what navigation may show for that identity.
// AppProvider/ReportProvider: ParkWatch data, still the LOCAL store in T8.2.
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <SessionProvider>
          <AppProvider>
            <ReportProvider>
              <AvatarProvider>
                <StatusBar style="dark" />
                <Stack screenOptions={{ headerShown: false }} />
              </AvatarProvider>
            </ReportProvider>
          </AppProvider>
        </SessionProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
