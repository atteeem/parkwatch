import React, { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { DevSettings } from "react-native";
import { EnforcementOutcomeCode, ReportDraft, Result, validateWithdrawal } from "../domain";
import { Notification } from "../data/mockNotifications";
import { OfficerCase, UserReport } from "../data/types";
import {
  CHECK_KEY_TO_DOMAIN,
  InspectionCheckKey,
  InspectionView,
  OFFICER_PHOTO_KEY_TO_TYPE,
  OfficerPhotoKey,
  CaseDetailView,
  selectCaseDetail,
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

  // officer — every action returns its Result; screens must not navigate on failure.
  officerId: string;
  officerCases: OfficerCase[];
  /** Read-only; undefined for unknown ids (never mutates). */
  getCase: (id: string | undefined | null) => OfficerCase | undefined;
  getCaseDetail: (id: string | undefined | null) => CaseDetailView | undefined;
  getInspection: (caseId: string) => OfficerInspectionDraft;
  acceptCase: (id: string) => Result<void>;
  startEnRoute: (id: string) => Result<void>;
  startInspection: (id: string) => Result<void>;
  setChecklistItem: (caseId: string, key: InspectionCheckKey, value: boolean | null) => Result<void>;
  /** DEVELOPMENT/MOCK plate confirmation (no OCR). */
  confirmPlateBySimulatedScan: (caseId: string) => Result<void>;
  setOfficerPhoto: (caseId: string, key: OfficerPhotoKey, uri: string, capturedAt?: string) => Result<{ evidenceId: string }>;
  /** Record the enforcement outcome (charge amount always from config). */
  completeCase: (caseId: string, code: EnforcementOutcomeCode, notes?: string) => Result<{ changed: boolean }>;

  // notifications
  userNotifications: Notification[];
  officerNotifications: Notification[];
  markUserNotificationsRead: () => void;
  markOfficerNotificationsRead: () => void;
  /** DEVELOPMENT/DEMO ONLY (no-op in production): reset to the known demo seed. */
  resetDemoData: () => Promise<void>;
};

const AppContext = createContext<AppContextValue | null>(null);

const citizen = { role: "CITIZEN" as const, accountId: DEV_CITIZEN_ID };
const officer = { role: "OFFICER" as const, accountId: DEV_OFFICER_ID };

/** DEVELOPMENT/DEMO ONLY: back to the known demo seed. A no-op in production builds. */
function resetDemoData(): Promise<void> {
  return __DEV__ ? appStore.resetToSeed() : Promise.resolve();
}

function registerDevTools() {
  if (!__DEV__) return;
  const reset = () => resetDemoData().then(() => console.log("[ParkWatch] mock state reset to seed"));
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

      officerId: DEV_OFFICER_ID,
      officerCases,
      getCase: (id) => (id ? officerCases.find((c) => c.id === id) : undefined),
      getCaseDetail: (id) => (id ? selectCaseDetail(state, id, now) : undefined),
      getInspection: (caseId) => toInspectionView(caseId, state.inspections[caseId]),
      acceptCase: (id) => appStore.acceptCase(id, DEV_OFFICER_ID),
      startEnRoute: (id) => appStore.startEnRoute(id, DEV_OFFICER_ID),
      startInspection: (id) => appStore.startInspection(id, DEV_OFFICER_ID),
      setChecklistItem: (caseId, key, value) => appStore.updateChecklist(caseId, CHECK_KEY_TO_DOMAIN[key], value),
      confirmPlateBySimulatedScan: (caseId) => appStore.confirmPlateBySimulatedScan(caseId),
      // Officer slot photos only come from the in-app camera screen.
      setOfficerPhoto: (caseId, key, uri, capturedAt) =>
        appStore.attachOfficerPhoto(caseId, OFFICER_PHOTO_KEY_TO_TYPE[key], uri, "CAMERA", capturedAt),
      completeCase: (caseId, code, notes) => {
        const r = appStore.completeCase(caseId, code, DEV_OFFICER_ID, notes);
        return r.ok ? { ok: true, value: { changed: r.value.changed } } : r;
      },

      userNotifications: selectNotifications(state, citizen, now),
      officerNotifications: selectNotifications(state, officer, now),
      markUserNotificationsRead: () => {
        appStore.markNotificationsRead(citizen);
      },
      resetDemoData,
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
