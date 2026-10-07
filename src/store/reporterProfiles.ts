import { DEV_CITIZEN_ID } from "./session";

/**
 * DISPLAY-ONLY reporter information shown to officers (name, reliability,
 * acceptance rate, verified count) as in the current designs.
 *
 * This is deliberately isolated from enforcement logic: no domain rule,
 * case transition or outcome reads it. Officers must verify every report
 * independently. Later this comes from a reporter-reputation service with
 * appropriate privacy limits.
 */
export type ReporterDisplayProfile = {
  displayName: string;
  reliability: "Low" | "Medium" | "High" | "Not rated";
  /** false: no statistics exist for this reporter; screens must not show invented numbers. */
  known: boolean;
  acceptanceRate: number;
  verifiedReports: number;
};

const PROFILES: Record<string, Omit<ReporterDisplayProfile, "known">> = {
  [DEV_CITIZEN_ID]: { displayName: "Mika S.", reliability: "High", acceptanceRate: 92, verifiedReports: 79 },
  "citizen-elina": { displayName: "Elina R.", reliability: "High", acceptanceRate: 88, verifiedReports: 41 },
  "citizen-jonas": { displayName: "Jonas L.", reliability: "High", acceptanceRate: 95, verifiedReports: 112 },
  "citizen-sara": { displayName: "Sara K.", reliability: "High", acceptanceRate: 81, verifiedReports: 23 },
  "citizen-otto": { displayName: "Otto V.", reliability: "Medium", acceptanceRate: 74, verifiedReports: 12 },
  "citizen-nea": { displayName: "Nea H.", reliability: "High", acceptanceRate: 90, verifiedReports: 55 },
  "citizen-ilkka": { displayName: "Ilkka T.", reliability: "Medium", acceptanceRate: 70, verifiedReports: 9 },
  "citizen-pia": { displayName: "Pia M.", reliability: "High", acceptanceRate: 93, verifiedReports: 61 },
};

const UNKNOWN: ReporterDisplayProfile = {
  displayName: "Citizen reporter",
  reliability: "Not rated",
  known: false,
  acceptanceRate: 0,
  verifiedReports: 0,
};

export function getReporterDisplayProfile(citizenId: string): ReporterDisplayProfile {
  const p = PROFILES[citizenId];
  return p ? { ...p, known: true } : UNKNOWN;
}

/** The signed-in citizen in server-backed mode: their own name, no invented statistics. */
export function ownReporterProfile(displayName: string): ReporterDisplayProfile {
  return { ...UNKNOWN, displayName: displayName.trim() || "You" };
}
