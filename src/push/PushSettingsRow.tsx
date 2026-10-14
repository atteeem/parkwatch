// "Push Notifications" settings row: the truthful state of push on this
// device, and the one place to turn it on later (or reach the system settings).

import React from "react";
import { SettingsRow } from "../components/SettingsRow";
import { usePushNotifications } from "./PushNotificationsContext";
import { PUSH_COPY } from "./pushRegistration";

export function PushSettingsRow() {
  const push = usePushNotifications();
  const subtitle = PUSH_COPY.status[push.status];
  if (push.status === "unavailable") return <SettingsRow icon="notifications" title={PUSH_COPY.settingsTitle} subtitle={subtitle} unavailable />;
  if (push.status === "enabled") return <SettingsRow icon="notifications" title={PUSH_COPY.settingsTitle} subtitle={subtitle} />;
  const onPress = push.status === "blocked" ? push.openSettings : () => void push.enable();
  return <SettingsRow icon="notifications" title={PUSH_COPY.settingsTitle} subtitle={subtitle} onPress={onPress} />;
}
