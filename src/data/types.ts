// Screen-facing VIEW MODELS and display catalogs.
//
// UserReport / OfficerCase are the shapes the existing screens consume. They
// are produced from domain state by src/presentation/viewModels.ts and carry
// display-ready values (legacy status strings, euros, labels). Business rules
// live in src/domain, not here.

export type UserReportStatus = "under-review" | "verified" | "rejected";

export type UserReport = {
  id: string;
  plate: string;
  vehicle?: string;
  vehicleColor?: string;
  violation: string;
  violationNote?: string;
  location: string;
  coordinates?: { latitude: number; longitude: number };
  status: UserReportStatus;
  reward?: number;
  rewardState?: "estimated" | "rewarded" | "none";
  submittedAt: string;
  images: string[];
  notes?: string;
  highPriority?: boolean;
};

export type CasePriority = "normal" | "medium" | "high";

export type CaseStatus =
  | "new"
  | "assigned"
  | "en-route"
  | "on-site"
  | "inspection"
  | "completed"
  | "rejected";

export type ReporterReliability = "Low" | "Medium" | "High";

export type OfficerCase = {
  id: string;
  reportId: string; // links back to the citizen UserReport that created this case
  plate: string;
  vehicle?: string;
  violation: string;
  location: string;
  distance: number; // km
  priority: CasePriority;
  status: CaseStatus;
  reporterReliability: ReporterReliability;
  reporterName: string;
  reporterAcceptanceRate: number;
  reporterVerifiedReports: number;
  images: string[];
  reportedAgo: string;
  notes?: string;
  chargeAmount?: number;
  /** Domain enforcement outcome code once completed (e.g. "CHARGE_ISSUED"). */
  outcomeCode?: string;
  /** ISO completion time, when completed. */
  completedAt?: string;
};

export const VIOLATION_TYPES = [
  { id: "no-parking", label: "No parking zone", note: "Parked where parking is prohibited." },
  { id: "sidewalk", label: "Sidewalk", note: "Blocking or partly parked on the sidewalk." },
  { id: "crosswalk", label: "Crosswalk", note: "Parked on or too close to a pedestrian crossing." },
  { id: "disabled", label: "Disabled parking", note: "Using an accessible space without authorization." },
  { id: "fire-lane", label: "Fire lane", note: "Blocking an emergency access route." },
  { id: "bus-stop", label: "Bus stop", note: "Parked in a bus or public transport stop." },
  { id: "blocking-traffic", label: "Blocking traffic", note: "Obstructing vehicles, cyclists or pedestrians." },
  { id: "loading-zone", label: "Loading zone", note: "Parked in a restricted loading area." },
  { id: "time-restriction", label: "Time restriction", note: "Parking time appears to have expired." },
  { id: "other", label: "Other", note: "The issue is not listed above." },
] as const;

export const CLOSE_WITHOUT_CHARGE_REASONS = [
  { id: "moved", label: "Vehicle moved before arrival", note: "The vehicle was not at the location when you arrived.", icon: "car" as const },
  { id: "rejected", label: "Report rejected", note: "No violation found or insufficient evidence.", icon: "close" as const },
  { id: "permit", label: "Valid permit displayed", note: "A valid permit or authorization was displayed.", icon: "permit" as const },
  { id: "duplicate", label: "Duplicate report", note: "This issue has already been reported and handled.", icon: "duplicate" as const },
  { id: "other", label: "Other", note: "Other circumstances (specify in notes).", icon: "other" as const },
] as const;

export function violationLabel(id: string): string {
  return VIOLATION_TYPES.find((v) => v.id === id)?.label ?? id;
}
