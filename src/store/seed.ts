// Demo seed data, built through the SAME commands the app uses so every
// relationship is consistent by construction (report <-> case, completed
// cases have outcomes, citizen statuses follow resolved outcomes, one reward
// lifecycle per report).
//
// Timestamps are relative to `now` so the demo always looks recent. Content
// mirrors the Figma examples; large lifetime profile statistics stay
// display-only in the screens and are not derived from this small dataset.

import {
  ChecklistKey,
  CHECKLIST_KEYS,
  createCitizenEvidence,
  createPlateNumber,
  EnforcementOutcomeCode,
  MVP_DEFAULT_JURISDICTION_ID,
  GeoPoint,
  Notification,
  OFFICER_EVIDENCE_TYPES,
  recordOpeningBalance,
  ReportDraft,
  ReportPriority,
  Result,
  VehicleInfo,
} from "../domain";
import * as cmd from "./commands";
import { CommandResult } from "./commands";
import { DEV_CITIZEN_ID, DEV_OFFICER_ID } from "./session";
import { demoPhotoUri } from "../data/demoPhotos";
import { EMPTY_STATE, ParkWatchState } from "./state";

/** Copy of the seeded "withdrawal paid" notification (also used to repair old saved demo state). */
export const SEED_WITHDRAWAL_PAID_COPY = {
  title: "Withdrawal paid out",
  body: "Your withdrawal of €25.00 was marked as paid out.",
} as const;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Seeded evidence uses local demo URIs (rendered as neutral tiles), never downloaded images.
const img = (plate: string, slot: string) => demoPhotoUri(plate, slot);

type SeedReport = {
  reportId: string;
  citizenId: string;
  plate: string;
  make: string;
  model: string;
  color?: string;
  violationId: string;
  address: string;
  coordinates?: GeoPoint;
  notes: string;
  priority: ReportPriority;
  distanceMeters: number;
  /** How long ago it was submitted (ms). */
  age: number;
  /** Officer-side progress to apply after submission. */
  progress:
    | { to: "NEW" | "ASSIGNED" | "EN_ROUTE" | "ON_SITE" | "INSPECTION" }
    | { to: "COMPLETED"; outcome: EnforcementOutcomeCode; officerNotes?: string; after: number };
};

// Violation ids are canonical VIOLATION_TYPES ids. Old free-text seed labels
// were mapped: "Sidewalk Obstruction" -> sidewalk, "Bus Stop Blocked" /
// "Parking in bus stop" -> bus-stop, "Loading Zone Violation" -> loading-zone,
// "Double Parking" -> blocking-traffic, "No Parking" -> no-parking.
const REPORTS: SeedReport[] = [
  // --- the demo citizen's own reports (My Reports) ---
  {
    reportId: "12564", citizenId: DEV_CITIZEN_ID, plate: "XKR-418", make: "Volvo", model: "XC40", color: "White",
    violationId: "no-parking", address: "Mannerheimintie 45, Helsinki",
    coordinates: { latitude: 60.1699, longitude: 24.9384 }, notes: "Parked in a no parking zone.",
    priority: "HIGH", distanceMeters: 300, age: 5 * MIN, progress: { to: "NEW" },
  },
  {
    reportId: "12566", citizenId: DEV_CITIZEN_ID, plate: "ABC-123", make: "Toyota", model: "Corolla", color: "Black",
    violationId: "sidewalk", address: "Kalevankatu 12, Helsinki", coordinates: { latitude: 60.1665, longitude: 24.9381 }, notes: "",
    priority: "NORMAL", distanceMeters: 900, age: 1 * DAY, progress: { to: "NEW" },
  },
  {
    reportId: "12556", citizenId: DEV_CITIZEN_ID, plate: "MVP-207", make: "Toyota", model: "Corolla", color: "White",
    violationId: "crosswalk", address: "Kaivokatu 12, Helsinki",
    coordinates: { latitude: 60.1695, longitude: 24.9412 }, notes: "Parked on the pedestrian crossing.",
    priority: "NORMAL", distanceMeters: 500, age: 2 * DAY,
    progress: { to: "COMPLETED", outcome: "CHARGE_ISSUED", after: 40 * MIN },
  },
  {
    reportId: "12499", citizenId: DEV_CITIZEN_ID, plate: "LTX-561", make: "Mitsubishi", model: "Outlander", color: "Silver",
    violationId: "sidewalk", address: "Fredrikinkatu 22, Helsinki",
    coordinates: { latitude: 60.1665, longitude: 24.9354 }, notes: "Blocking the sidewalk.",
    priority: "NORMAL", distanceMeters: 800, age: 3 * DAY,
    progress: { to: "COMPLETED", outcome: "REPORT_REJECTED", officerNotes: "No violation found on site.", after: 30 * MIN },
  },
  {
    reportId: "12484", citizenId: DEV_CITIZEN_ID, plate: "FNA-782", make: "Mercedes-Benz", model: "Sprinter", color: "Black",
    violationId: "bus-stop", address: "Elielinaukio 5, Helsinki",
    coordinates: { latitude: 60.1719, longitude: 24.9414 }, notes: "Vehicle parked directly in a bus stop and has been there for a while.",
    priority: "HIGH", distanceMeters: 350, age: 4 * DAY,
    progress: { to: "COMPLETED", outcome: "CHARGE_ISSUED", after: 25 * MIN },
  },
  {
    reportId: "12477", citizenId: DEV_CITIZEN_ID, plate: "JEH-523", make: "BMW", model: "3 Series", color: "Black",
    violationId: "loading-zone", address: "Pohjoisesplanadi 33, Helsinki",
    coordinates: { latitude: 60.1652, longitude: 24.9478 }, notes: "Parked in a loading zone.",
    priority: "NORMAL", distanceMeters: 400, age: 4 * DAY + 2 * HOUR,
    progress: { to: "COMPLETED", outcome: "CHARGE_ISSUED", after: 35 * MIN },
  },
  // --- other citizens' reports (officer queue) ---
  {
    reportId: "12571", citizenId: "citizen-elina", plate: "JBS-236", make: "Mercedes-Benz", model: "E-Class",
    violationId: "sidewalk", address: "Kaivokatu 12, Helsinki", coordinates: { latitude: 60.1706, longitude: 24.9422 }, notes: "",
    priority: "NORMAL", distanceMeters: 500, age: 6 * MIN, progress: { to: "ASSIGNED" },
  },
  {
    reportId: "12572", citizenId: "citizen-jonas", plate: "NMV-224", make: "Mitsubishi", model: "Outlander",
    violationId: "sidewalk", address: "Fredrikinkatu 22, Helsinki", coordinates: { latitude: 60.1652, longitude: 24.9355 }, notes: "",
    priority: "HIGH", distanceMeters: 800, age: 6 * MIN, progress: { to: "NEW" },
  },
  {
    reportId: "12573", citizenId: "citizen-sara", plate: "MGC-703", make: "Mercedes-Benz", model: "Sprinter",
    violationId: "bus-stop", address: "Elielinaukio 5, Helsinki", coordinates: { latitude: 60.1716, longitude: 24.94 }, notes: "",
    priority: "MEDIUM", distanceMeters: 1200, age: 6 * MIN, progress: { to: "NEW" },
  },
  {
    reportId: "12574", citizenId: "citizen-otto", plate: "FET-853", make: "BMW", model: "3 Series",
    violationId: "loading-zone", address: "Pohjoisesplanadi 33, Helsinki", coordinates: { latitude: 60.168, longitude: 24.9466 }, notes: "",
    priority: "NORMAL", distanceMeters: 1500, age: 6 * MIN, progress: { to: "NEW" },
  },
  {
    reportId: "12568", citizenId: "citizen-nea", plate: "BHN-632", make: "Audi", model: "A4",
    violationId: "blocking-traffic", address: "Fredrikinkatu 22, Helsinki", coordinates: { latitude: 60.1652, longitude: 24.9355 }, notes: "",
    priority: "NORMAL", distanceMeters: 700, age: 18 * MIN, progress: { to: "EN_ROUTE" },
  },
  {
    reportId: "12569", citizenId: "citizen-ilkka", plate: "HGT-355", make: "Skoda", model: "Octavia",
    violationId: "no-parking", address: "Pohjoisesplanadi 33, Helsinki", coordinates: { latitude: 60.168, longitude: 24.9466 }, notes: "",
    priority: "NORMAL", distanceMeters: 1100, age: 18 * MIN, progress: { to: "ON_SITE" },
  },
  {
    reportId: "12570", citizenId: "citizen-pia", plate: "KOL-790", make: "Ford", model: "Transit",
    violationId: "loading-zone", address: "Elielinaukio 5, Helsinki", coordinates: { latitude: 60.1716, longitude: 24.94 }, notes: "",
    priority: "NORMAL", distanceMeters: 1500, age: 18 * MIN, progress: { to: "INSPECTION" },
  },
];

/** Seed bugs must fail loudly (they are covered by tests). */
function must<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`Seed failed: ${r.error.code}: ${r.error.message}`);
  return r.value;
}

function seedDraft(r: SeedReport, capturedAt: string): ReportDraft {
  const photo = (type: "FRONT" | "SIDE" | "REAR") =>
    createCitizenEvidence({
      id: `ev-seed-${r.reportId}-${type}`,
      type,
      captureSource: "SEED",
      uri: img(r.plate, type),
      capturedAt,
    });
  return {
    draftId: `seed-draft-${r.reportId}`,
    photos: { FRONT: photo("FRONT"), SIDE: photo("SIDE"), REAR: photo("REAR") },
    violationId: r.violationId,
    location: { address: r.address, coordinates: r.coordinates },
    observedAt: capturedAt,
    notes: r.notes,
    attachments: [],
  };
}

export function buildSeedState(now: Date): ParkWatchState {
  const at = (msAgo: number) => new Date(now.getTime() - msAgo).toISOString();
  let s: ParkWatchState = { ...EMPTY_STATE };
  const step = <T>(r: CommandResult<T>): T => {
    const v = must(r);
    s = v.state;
    return v.value;
  };

  // Citizen wallet history (Figma: €45 available, €55 paid out).
  // Opening balance €85 + 3 released €5 rewards = €100; €30 + €25 paid out.
  s = { ...s, ledger: [...must(recordOpeningBalance(s.ledger, { citizenId: DEV_CITIZEN_ID, amountCents: 8500, at: at(30 * DAY) }))] };
  step(cmd.requestCitizenWithdrawal(s, { citizenId: DEV_CITIZEN_ID, amountCents: 3000, withdrawalId: "w-seed-1", at: at(6 * DAY) }));
  step(cmd.confirmWithdrawalPaid(s, { withdrawalId: "w-seed-1", at: at(6 * DAY - HOUR) }));
  step(cmd.requestCitizenWithdrawal(s, { citizenId: DEV_CITIZEN_ID, amountCents: 2500, withdrawalId: "w-seed-2", at: at(2 * HOUR + 30 * MIN) }));
  step(cmd.confirmWithdrawalPaid(s, { withdrawalId: "w-seed-2", at: at(2 * HOUR) }));

  const vehicle = (r: SeedReport): VehicleInfo => ({
    plate: createPlateNumber(r.plate, "FI"), make: r.make, model: r.model, color: r.color, source: "MOCK_DETECTED",
  });

  for (const r of [...REPORTS].sort((a, b) => b.age - a.age)) {
    const submittedAt = at(r.age);
    step(
      cmd.createSubmission(
        s,
        { draft: seedDraft(r, submittedAt), citizenId: r.citizenId, at: submittedAt, source: "SEED" },
        {
          reportId: r.reportId,
          jurisdictionId: MVP_DEFAULT_JURISDICTION_ID,
          vehicle: vehicle(r),
          priority: r.priority,
          distanceMeters: r.distanceMeters,
        }
      )
    );
    const caseId = `c-${r.reportId}`;
    const t = (msAfter: number) => at(r.age - msAfter);
    // Seeded officer actions are attributed to the stable dev officer id and marked SEED.
    const officer = { caseId, officerId: DEV_OFFICER_ID, source: "SEED" as const };
    const p = r.progress;

    if (p.to === "NEW") continue;
    if (p.to === "ASSIGNED") {
      step(cmd.assignCase(s, { ...officer, at: t(MIN) }));
      continue;
    }
    step(cmd.acceptCase(s, { ...officer, at: t(MIN) }));
    if (p.to === "EN_ROUTE") continue;
    if (p.to === "ON_SITE") {
      step(cmd.arriveOnSite(s, { ...officer, at: t(5 * MIN) }));
      continue;
    }
    step(cmd.startInspection(s, { ...officer, at: t(8 * MIN) }));
    if (p.to !== "COMPLETED") continue;

    for (const key of CHECKLIST_KEYS) step(cmd.updateChecklist(s, { caseId, key: key as ChecklistKey, value: true }));
    for (const type of OFFICER_EVIDENCE_TYPES) {
      step(
        cmd.attachOfficerPhoto(s, {
          caseId,
          type,
          captureSource: "SEED",
          uri: img(r.plate, type),
          at: t(10 * MIN),
        })
      );
    }
    step(cmd.completeCase(s, { ...officer, code: p.outcome, notes: p.officerNotes, at: t(p.after) }));
  }

  // Free-form messages from the designs that are not domain events (citizen only;
  // officer notifications come only from real case events).
  const system = (
    id: string,
    role: "CITIZEN" | "OFFICER",
    msAgo: number,
    title: string,
    body: string,
    displayHint: string
  ): Notification => ({
    id: `seed-${id}`,
    idempotencyKey: `seed-${id}`,
    recipient: { role, accountId: role === "CITIZEN" ? DEV_CITIZEN_ID : DEV_OFFICER_ID },
    type: "SYSTEM",
    createdAt: at(msAgo),
    title,
    body,
    displayHint,
  });
  s = {
    ...s,
    notifications: [
      ...s.notifications,
      system("withdrawal-2", "CITIZEN", 2 * HOUR, SEED_WITHDRAWAL_PAID_COPY.title, SEED_WITHDRAWAL_PAID_COPY.body, "info"),
      system("feature", "CITIZEN", 3 * DAY, "New feature available", "You can now add more details to your reports. Check it out!", "bell"),
      system("welcome", "CITIZEN", 6 * DAY, "Welcome bonus", "Thank you for joining! You received a welcome bonus.", "gift"),
    ],
  };

  // Older notifications start as read; recent ones unread (as in the designs).
  const readCutoff = now.getTime() - 3 * HOUR;
  s = {
    ...s,
    notifications: s.notifications.map((n) =>
      Date.parse(n.createdAt) < readCutoff ? { ...n, readAt: n.readAt ?? at(3 * HOUR) } : n
    ),
    nextReportNumber: 12600,
  };
  return s;
}
