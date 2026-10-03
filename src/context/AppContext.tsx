import React, { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { DevSettings } from "react-native";
import { ReportDraft, Result, validateWithdrawal } from "../domain";
import { Notification } from "../data/mockNotifications";
import { CaseStatus, OfficerCase, UserReport } from "../data/types";
import {
  CHECK_KEY_TO_DOMAIN,
  InspectionCheckKey,
  InspectionView,
  OFFICER_PHOTO_KEY_TO_TYPE,
  OfficerPhotoKey,
  RESULT_SELECTION_TO_OUTCOME,
  selectCitizenReports,
  selectNotifications,
  selectOfficerCases,
  selectWallet,
  toInspectionView,
} from "../presentation/viewModels";
import { selectCitizenReportById } from "../presentation/citizenViews";
import { EarningsPeriod, selectEarnings, selectWalletActivity, WalletActivityItem, EarningsSummary } from "../presentation/walletViews";
import { asyncStorageAdapter } from "../store/asyncStorageAdapter";
import { getReporterDisplayProfile, ReporterDisplayProfile } from "../store/reporterProfiles";
import { buildSeedState } from "../store/seed";
import { DEV_CITIZEN_ID, DEV_OFFICER_ID } from "../store/session";
import { createParkWatchStore, ParkWatchStore } from "../store/store";

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

type AppContextValue = {
  // citizen
  userReports: UserReport[];
  /** Read-only lookup for detail screens / deep links (null if unknown or not this citizen's). */
  getCitizenReport: (id: string | undefined | null) => UserReport | null;
  /** Display profile of the signed-in (dev) citizen, as shown to officers. */
  citizenProfile: ReporterDisplayProfile;
  /** Submit the draft. Idempotent per draftId: a repeat returns the same report (created=false). */
  submitReport: (draft: ReportDraft) => Result<{ reportId: string; created: boolean }>;
  walletAvailable: number;
  walletPending: number;
  walletPaidOut: number;
  walletActivity: WalletActivityItem[];
  getEarnings: (period: EarningsPeriod) => EarningsSummary;
  /** Check an amount (cents) against the wallet rules without changing anything. */
  validateWithdrawal: (amountCents: number) => Result<true>;
  /** Simulated withdrawal REQUEST (no real transfer). */
  withdraw: (amountCents: number) => Result<{ withdrawalId: string }>;

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
      getCitizenReport: (id) => selectCitizenReportById(state, DEV_CITIZEN_ID, id),
      citizenProfile: getReporterDisplayProfile(DEV_CITIZEN_ID),
      submitReport: (draft) => appStore.submitReport(draft, DEV_CITIZEN_ID),
      walletAvailable: wallet.available,
      walletPending: wallet.pending,
      walletPaidOut: wallet.paidOut,
      walletActivity: selectWalletActivity(state, DEV_CITIZEN_ID),
      getEarnings: (period) => selectEarnings(state, DEV_CITIZEN_ID, period, now),
      validateWithdrawal: (amountCents) => validateWithdrawal(state.ledger, DEV_CITIZEN_ID, amountCents),
      withdraw: (amountCents) => appStore.requestWithdrawal(DEV_CITIZEN_ID, amountCents),

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
        // Officer slot photos only come from the in-app camera screen.
        appStore.attachOfficerPhoto(caseId, OFFICER_PHOTO_KEY_TO_TYPE[key], uri, "CAMERA");
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
