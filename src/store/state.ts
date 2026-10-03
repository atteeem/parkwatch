import { Inspection, Notification, OfficerCase, Report, RewardLedgerEntry } from "../domain";

/**
 * The complete persisted ParkWatch MVP state. Domain objects only — no
 * display strings, no UI flags. View models are derived in src/presentation.
 */
export type ParkWatchState = {
  reports: Report[];
  cases: OfficerCase[];
  /** Case-linked inspections, keyed by case id (one inspection per case). */
  inspections: Record<string, Inspection>;
  ledger: RewardLedgerEntry[];
  notifications: Notification[];
  /** Monotonic counter for generated ids; persisted so ids never repeat after reload. */
  seq: number;
  /** Next citizen-visible report number (e.g. "12600"). */
  nextReportNumber: number;
};

export const EMPTY_STATE: ParkWatchState = {
  reports: [],
  cases: [],
  inspections: {},
  ledger: [],
  notifications: [],
  seq: 1,
  nextReportNumber: 12600,
};
