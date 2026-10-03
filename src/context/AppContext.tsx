import React, { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { DevSettings } from "react-native";
import { createCitizenEvidence, ReportDraft as DomainDraft } from "../domain";
import { Notification } from "../data/mockNotifications";
import { CaseStatus, OfficerCase, UserReport } from "../data/types";
import {
  CHECK_KEY_TO_DOMAIN,
  eurosToCents,
  InspectionCheckKey,
  InspectionView,
  OFFICER_PHOTO_KEY_TO_TYPE,
  OfficerPhotoKey,
  RESULT_SELECTION_TO_OUTCOME,
  selectCitizenReports,
  selectNotifications,
  selectOfficerCases,
  selectWallet,
  toCitizenReportView,
  toInspectionView,
} from "../presentation/viewModels";
import { asyncStorageAdapter } from "../store/asyncStorageAdapter";
import { buildSeedState } from "../store/seed";
import { DEV_CITIZEN_ID, DEV_OFFICER_ID } from "../store/session";
import { createParkWatchStore, ParkWatchStore } from "../store/store";
import { CitizenPhotoSlot } from "./ReportContext";

// AppContext is now a thin React binding over the ParkWatch store:
// - state lives in src/store (persisted, domain-typed)
// - every rule is decided in src/domain
// - screens receive view models from src/presentation
// The public API below keeps the names/shapes the existing screens use.

/** Kept for screen compatibility: the per-case inspection view. */
export type OfficerInspectionDraft = InspectionView;

const appStore: ParkWatchStore = createParkWatchStore({
  storage: asyncStorageAdapter,
  seed: buildSeedState,
  onPersistError: (e) => console.warn("[ParkWatch] failed to persist state", e),
  onDiscard: (reason) => console.warn(`[ParkWatch] discarded persisted state (${reason}); reseeding`),
});

type SubmitReportInput = {
  /** ReportContext draft id; makes repeated submits of the same draft a no-op. */
  draftId?: string;
  photos?: Partial<Record<CitizenPhotoSlot, string>>;
  photoCapturedAt?: Partial<Record<CitizenPhotoSlot, string>>;
  /** Legacy: ordered [front, side, rear] when `photos` is not given. */
  images?: string[];
  violation: string;
  location: string;
  date: string;
  time: string;
  notes: string;
};

type AppContextValue = {
  // citizen
  userReports: UserReport[];
  /** Returns the submitted (or already-submitted) report, or null if the domain refused it. */
  submitUserReport: (input: SubmitReportInput) => UserReport | null;
  walletAvailable: number;
  walletPending: number;
  walletPaidOut: number;
  /** Simulated withdrawal request in euros. Returns false if the wallet rules refuse it. */
  withdraw: (amount: number) => boolean;

  // officer
  officerCases: OfficerCase[];
  getCase: (id: string) => OfficerCase | undefined;
  acceptCase: (id: string) => boolean;
  setCaseStatus: (id: string, status: CaseStatus) => boolean;
  startInspectionDraft: (caseId: string) => void;
  getInspection: (caseId: string) => OfficerInspectionDraft;
  updateInspection: (
    caseId: string,
    patch: Partial<Record<InspectionCheckKey, boolean | null>> & { notes?: string }
  ) => void;
  setOfficerPhoto: (caseId: string, key: OfficerPhotoKey, uri: string) => void;
  completeInspection: (
    id: string,
    result: { outcome: "charge" | "closed"; reasonId?: string; chargeAmount?: number; notes?: string }
  ) => boolean;

  // notifications
  userNotifications: Notification[];
  officerNotifications: Notification[];
  markUserNotificationsRead: () => void;
  markOfficerNotificationsRead: () => void;
};

const AppContext = createContext<AppContextValue | null>(null);

const citizen = { role: "CITIZEN" as const, accountId: DEV_CITIZEN_ID };
const officer = { role: "OFFICER" as const, accountId: DEV_OFFICER_ID };

function toDomainDraft(input: SubmitReportInput): DomainDraft {
  const draftId = input.draftId ?? `draft-legacy-${Date.now().toString(36)}`;
  const slots: CitizenPhotoSlot[] = ["front", "side", "rear"];
  const uris = input.photos ?? Object.fromEntries(slots.map((s, i) => [s, input.images?.[i]]));
  const fallbackAt = new Date().toISOString();
  const photo = (slot: CitizenPhotoSlot, type: "FRONT" | "SIDE" | "REAR") => {
    const uri = uris[slot];
    return uri
      ? createCitizenEvidence({ id: `${draftId}-${type}`, type, uri, capturedAt: input.photoCapturedAt?.[slot] ?? fallbackAt })
      : undefined;
  };
  return {
    draftId,
    photos: { FRONT: photo("front", "FRONT"), SIDE: photo("side", "SIDE"), REAR: photo("rear", "REAR") },
    violationId: input.violation || undefined,
    location: { address: input.location ?? "" },
    notes: input.notes ?? "",
    attachments: [],
  };
}

function registerDevTools() {
  if (!__DEV__) return;
  const reset = () => {
    void appStore.resetToSeed().then(() => console.log("[ParkWatch] mock state reset to seed"));
  };
  // Native: Expo dev menu item. Web: callable from the browser console.
  DevSettings?.addMenuItem?.("ParkWatch: reset mock data", reset);
  (globalThis as Record<string, unknown>).__parkwatchResetMockState = reset;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(appStore.isHydrated());

  useEffect(() => {
    registerDevTools();
    if (!appStore.isHydrated()) void appStore.hydrate().then(() => setHydrated(true));
  }, []);

  const state = useSyncExternalStore(appStore.subscribe, appStore.getSnapshot, appStore.getSnapshot);

  const value = useMemo<AppContextValue | null>(() => {
    if (!state) return null;
    const now = new Date();
    const officerCases = selectOfficerCases(state, now);
    const wallet = selectWallet(state, DEV_CITIZEN_ID);

    return {
      userReports: selectCitizenReports(state, DEV_CITIZEN_ID),
      submitUserReport: (input) => {
        const r = appStore.submitReport(toDomainDraft(input), DEV_CITIZEN_ID);
        if (!r.ok) {
          console.warn("[ParkWatch] report not submitted:", r.error.message);
          return null;
        }
        const snapshot = appStore.getSnapshot()!;
        const report = snapshot.reports.find((x) => x.id === r.value.reportId);
        return report ? toCitizenReportView(report, snapshot) : null;
      },
      walletAvailable: wallet.available,
      walletPending: wallet.pending,
      walletPaidOut: wallet.paidOut,
      withdraw: (amount) => appStore.requestWithdrawal(DEV_CITIZEN_ID, eurosToCents(amount)).ok,

      officerCases,
      getCase: (id) => officerCases.find((c) => c.id === id),
      acceptCase: (id) => appStore.acceptCase(id, DEV_OFFICER_ID).ok,
      setCaseStatus: (id, status) => {
        if (status === "en-route") return appStore.startEnRoute(id, DEV_OFFICER_ID).ok;
        if (status === "inspection") return appStore.startInspection(id, DEV_OFFICER_ID).ok;
        return false; // other moves go through their dedicated actions
      },
      startInspectionDraft: (caseId) => {
        appStore.ensureInspection(caseId);
      },
      getInspection: (caseId) => toInspectionView(caseId, state.inspections[caseId]),
      updateInspection: (caseId, patch) => {
        for (const [key, domainKey] of Object.entries(CHECK_KEY_TO_DOMAIN) as [InspectionCheckKey, typeof CHECK_KEY_TO_DOMAIN[InspectionCheckKey]][]) {
          if (key in patch) appStore.updateChecklist(caseId, domainKey, patch[key] ?? null);
        }
        if (patch.notes !== undefined) appStore.updateInspectionNotes(caseId, patch.notes);
      },
      setOfficerPhoto: (caseId, key, uri) => {
        appStore.attachOfficerPhoto(caseId, OFFICER_PHOTO_KEY_TO_TYPE[key], uri);
      },
      completeInspection: (id, result) => {
        const selection = result.outcome === "charge" ? "charge" : result.reasonId ?? "other";
        const code = RESULT_SELECTION_TO_OUTCOME[selection];
        if (!code) return false;
        // The charge amount comes from domain config, not from the screen.
        const r = appStore.completeCase(id, code, DEV_OFFICER_ID, result.notes);
        if (!r.ok) console.warn("[ParkWatch] case not completed:", r.error.message);
        return r.ok;
      },

      userNotifications: selectNotifications(state, citizen, now),
      officerNotifications: selectNotifications(state, officer, now),
      markUserNotificationsRead: () => {
        appStore.markNotificationsRead(citizen);
      },
      markOfficerNotificationsRead: () => {
        appStore.markNotificationsRead(officer);
      },
    };
  }, [state]);

  // Render nothing until persisted state is loaded (a few ms), so no action
  // can run against seed data that is about to be replaced.
  if (!hydrated || !value) return null;
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
