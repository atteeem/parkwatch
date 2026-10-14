// Where tapping a push goes: the same targets as the in-app notification list
// (T8.8 deep links), resolved from the push payload only. A push for the
// other role (e.g. the device is now signed in to a different kind of
// account) opens nothing; the detail screens still load through the normal
// access-checked path and show "not available" if the record isn't theirs.

import { parsePushData } from "../../supabase/functions/_shared/pushContent";
import { citizenNotificationTarget, NotificationTarget, officerNotificationTarget } from "../navigation/notificationTargets";

export function pushTarget(data: unknown, sessionRole: string | null): NotificationTarget | null {
  const d = parsePushData(data);
  if (!d) return null;
  if (d.role === "CITIZEN") {
    if (sessionRole !== "citizen") return null;
    return citizenNotificationTarget({ type: d.type, reportId: d.reportId }, () => false, { serverScoped: true });
  }
  if (sessionRole !== "officer") return null;
  return officerNotificationTarget({ type: d.type, caseId: d.caseId }, () => false, { serverScoped: true });
}

/** Each notification opens at most once (a cold-start response is also delivered to the listener on some platforms). */
export function createOnceFilter(max = 50) {
  const seen: string[] = [];
  return (id: string): boolean => {
    if (seen.includes(id)) return false;
    seen.push(id);
    if (seen.length > max) seen.shift();
    return true;
  };
}
