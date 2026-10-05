import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AppState, DevSettings } from "react-native";
import { activeParkingSession, DomainError, EnforcementOutcomeCode, fail, NewVehicleInput, ParkingSession, ReportDraft, Result, validateWithdrawal } from "../domain";
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
import { ParkingHistoryItem, parkingHistory, VehicleView, vehicleViews } from "../presentation/parkingViews";
import { ActionResult } from "../presentation/submitGuard";
import { useAuth } from "../auth/AuthContext";
import { createCoreBackendStore, CoreBackendStore, CoreStatus, SubmitProgress } from "../backend/core/coreBackendStore";
import { createCoreOperations } from "../backend/operations/coreOperations";
import { createEvidenceStorage } from "../backend/storage/evidenceStorage";
import { getSupabaseClient } from "../backend/supabase";
import { asyncStorageAdapter } from "../store/asyncStorageAdapter";
import { getReporterDisplayProfile, ownReporterProfile, ReporterDisplayProfile } from "../store/reporterProfiles";
import { buildSeedState } from "../store/seed";
import { DEV_CITIZEN_ID, DEV_OFFICER_ID } from "../store/session";
import { EMPTY_STATE, ParkWatchState } from "../store/state";
import { createParkWatchStore, ParkWatchStore } from "../store/store";
import { useSession } from "./SessionContext";

// AppContext: the ONE core data boundary the screens use.
//
// * LOCAL_DEMO (no backend configured): the persisted local store (T7), with
//   the dev accounts. Actions answer synchronously.
// * BACKEND (Supabase configured): the server owns reports, cases,
//   inspections, rewards and notifications (src/backend/core). Actions are
//   server calls and answer asynchronously. There is NO fallback to local
//   or demo data in this mode. Parking stays local in both modes (T8.3).
//
// Screens receive the same view models either way and treat every core
// action as an ActionResult (sync or Promise).

/** Kept for screen compatibility: the per-case inspection view. */
export type OfficerInspectionDraft = InspectionView;

export type DataSource = "LOCAL_DEMO" | "BACKEND";

/** Loading state of the core data. LOCAL_DEMO is always "ready". */
export type CoreDataStatus = Pick<CoreStatus, "phase" | "refreshing" | "error">;

export type AppCapabilities = {
  /** Withdrawal requests. Disabled in the backend preview (no payout flow on the server yet). */
  withdrawals: boolean;
  /** Dev-only demo reset tools (local demo only). */
  demoTools: boolean;
};

/** Copy shown wherever withdrawals are disabled. */
export const WITHDRAWALS_UNAVAILABLE_COPY = "Withdrawals are not available in the backend preview yet.";

const appStore: ParkWatchStore = createParkWatchStore({
  storage: asyncStorageAdapter,
  seed: buildSeedState,
  onPersistError: (e) => console.warn("[ParkWatch] failed to persist state", e),
  onDiscard: (reason) => console.warn(`[ParkWatch] discarded persisted state (${reason}); reseeding`),
});

type AppContextValue = {
  dataSource: DataSource;
  coreStatus: CoreDataStatus;
  /** Re-load the core data now (pull-to-refresh, Retry). No-op in LOCAL_DEMO. */
  refreshCore: () => Promise<void>;
  /** Screen focus / foreground: refresh unless the data is very fresh. No-op in LOCAL_DEMO. */
  refreshCoreIfStale: () => void;
  capabilities: AppCapabilities;

  // citizen
  userReports: UserReport[];
  /** Read-only lookup for detail screens / deep links (null if unknown or not this citizen's). */
  getCitizenReport: (id: string | undefined | null) => UserReport | null;
  /** Display profile of the signed-in citizen. */
  citizenProfile: ReporterDisplayProfile;
  /** Submit the draft. Idempotent per draftId: a repeat returns the same report (created=false). */
  submitReport: (draft: ReportDraft, onProgress?: (p: SubmitProgress) => void) => ActionResult<{ reportId: string; created: boolean }>;
  walletAvailable: number;
  walletPending: number;
  walletPaidOut: number;
  walletActivity: WalletActivityItem[];
  getEarnings: (period: EarningsPeriod) => EarningsSummary;
  /** Check an amount (cents) against the wallet rules without changing anything. */
  validateWithdrawal: (amountCents: number) => Result<true>;
  /** Simulated withdrawal REQUEST (no real transfer). LOCAL_DEMO only. */
  withdraw: (amountCents: number) => Result<{ withdrawalId: string }>;
  // simulated parking (local only; no provider, no payment)
  vehicles: VehicleView[];
  activeParking: ParkingSession | undefined;
  parkingHistory: ParkingHistoryItem[];
  addVehicle: (input: NewVehicleInput) => Result<{ vehicleId: string }>;
  startParking: (vehicleId: string, zoneId: string, durationMinutes: number) => Result<{ sessionId: string }>;
  extendParking: (addedMinutes: number) => Result<{ sessionId: string }>;
  endParking: () => Result<{ sessionId: string }>;

  // officer — every action returns its result; screens must not navigate on failure.
  officerId: string;
  officerCases: OfficerCase[];
  /** Read-only; undefined for unknown ids (never mutates). */
  getCase: (id: string | undefined | null) => OfficerCase | undefined;
  getCaseDetail: (id: string | undefined | null) => CaseDetailView | undefined;
  getInspection: (caseId: string) => OfficerInspectionDraft;
  acceptCase: (id: string) => ActionResult<void>;
  startEnRoute: (id: string) => ActionResult<void>;
  startInspection: (id: string) => ActionResult<void>;
  setChecklistItem: (caseId: string, key: InspectionCheckKey, value: boolean | null) => ActionResult<void>;
  /** DEVELOPMENT/MOCK plate confirmation (no OCR). */
  confirmPlateBySimulatedScan: (caseId: string) => ActionResult<void>;
  setOfficerPhoto: (caseId: string, key: OfficerPhotoKey, uri: string, capturedAt?: string) => ActionResult<{ evidenceId: string }>;
  /** Record the enforcement outcome (charge amount always decided by the store/server, never the screen). */
  completeCase: (caseId: string, code: EnforcementOutcomeCode, notes?: string) => ActionResult<{ changed: boolean }>;

  // notifications
  userNotifications: Notification[];
  officerNotifications: Notification[];
  markUserNotificationsRead: () => void;
  markOfficerNotificationsRead: () => void;
  /** DEVELOPMENT/DEMO ONLY (no-op in production and in BACKEND mode): reset to the known demo seed. */
  resetDemoData: () => Promise<void>;
};

const AppContext = createContext<AppContextValue | null>(null);

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

/** Hydrate the local store (parking in both modes; everything in LOCAL_DEMO). */
function useLocalStore(): ParkWatchState | null {
  const [, setHydrated] = useState(appStore.isHydrated());
  useEffect(() => {
    if (!appStore.isHydrated()) void appStore.hydrate().then(() => setHydrated(true));
  }, []);
  return useSyncExternalStore(appStore.subscribe, appStore.getSnapshot, appStore.getSnapshot);
}

type CoreActions = Pick<
  AppContextValue,
  | "submitReport"
  | "acceptCase"
  | "startEnRoute"
  | "startInspection"
  | "setChecklistItem"
  | "confirmPlateBySimulatedScan"
  | "setOfficerPhoto"
  | "completeCase"
  | "markUserNotificationsRead"
  | "markOfficerNotificationsRead"
  | "validateWithdrawal"
  | "withdraw"
>;

/** Everything derived from core state with the same selectors in both modes. */
function buildValue(args: {
  core: ParkWatchState;
  parking: ParkWatchState;
  citizenId: string;
  officerId: string;
  parkingOwnerId: string;
  citizenProfile: ReporterDisplayProfile;
  actions: CoreActions;
  base: Pick<AppContextValue, "dataSource" | "coreStatus" | "refreshCore" | "refreshCoreIfStale" | "capabilities" | "resetDemoData">;
}): AppContextValue {
  const { core, parking, citizenId, officerId, parkingOwnerId } = args;
  const now = new Date();
  const officerCases = selectOfficerCases(core, now);
  const wallet = selectWallet(core, citizenId);
  return {
    ...args.base,
    ...args.actions,
    userReports: selectCitizenReports(core, citizenId),
    getCitizenReport: (id) => selectCitizenReportById(core, citizenId, id),
    citizenProfile: args.citizenProfile,
    walletAvailable: wallet.available,
    walletPending: wallet.pending,
    walletPaidOut: wallet.paidOut,
    walletActivity: selectWalletActivity(core, citizenId),
    getEarnings: (period) => selectEarnings(core, citizenId, period, now),

    // simulated parking: always the local store
    vehicles: vehicleViews(parking.vehicles, parking.parkingSessions, parkingOwnerId),
    activeParking: activeParkingSession(parking.parkingSessions, parkingOwnerId),
    parkingHistory: parkingHistory(parking.parkingSessions, parkingOwnerId),
    addVehicle: (input) => appStore.addVehicle(parkingOwnerId, input),
    startParking: (vehicleId, zoneId, minutes) => appStore.startParking(parkingOwnerId, vehicleId, zoneId, minutes),
    extendParking: (minutes) => appStore.extendParking(parkingOwnerId, minutes),
    endParking: () => appStore.endParking(parkingOwnerId),

    officerId,
    officerCases,
    getCase: (id) => (id ? officerCases.find((c) => c.id === id) : undefined),
    getCaseDetail: (id) => (id ? selectCaseDetail(core, id, now) : undefined),
    getInspection: (caseId) => toInspectionView(caseId, core.inspections[caseId]),

    userNotifications: selectNotifications(core, { role: "CITIZEN", accountId: citizenId }, now),
    officerNotifications: selectNotifications(core, { role: "OFFICER", accountId: officerId }, now),
  };
}

// ---------------------------------------------------------------------------
// LOCAL_DEMO

const READY: CoreDataStatus = { phase: "ready", refreshing: false, error: null };
const noRefresh = () => Promise.resolve();

function LocalAppProvider({ children }: { children: React.ReactNode }) {
  useEffect(registerDevTools, []);
  const state = useLocalStore();

  const value = useMemo<AppContextValue | null>(() => {
    if (!state) return null;
    const citizen = { role: "CITIZEN" as const, accountId: DEV_CITIZEN_ID };
    const officer = { role: "OFFICER" as const, accountId: DEV_OFFICER_ID };
    return buildValue({
      core: state,
      parking: state,
      citizenId: DEV_CITIZEN_ID,
      officerId: DEV_OFFICER_ID,
      parkingOwnerId: DEV_CITIZEN_ID,
      citizenProfile: getReporterDisplayProfile(DEV_CITIZEN_ID),
      base: {
        dataSource: "LOCAL_DEMO",
        coreStatus: READY,
        refreshCore: noRefresh,
        refreshCoreIfStale: () => undefined,
        capabilities: { withdrawals: true, demoTools: true },
        resetDemoData,
      },
      actions: {
        submitReport: (draft) => appStore.submitReport(draft, DEV_CITIZEN_ID),
        validateWithdrawal: (amountCents) => validateWithdrawal(state.ledger, DEV_CITIZEN_ID, amountCents),
        withdraw: (amountCents) => appStore.requestWithdrawal(DEV_CITIZEN_ID, amountCents),
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
        markUserNotificationsRead: () => {
          appStore.markNotificationsRead(citizen);
        },
        markOfficerNotificationsRead: () => {
          appStore.markNotificationsRead(officer);
        },
      },
    });
  }, [state]);

  // Render nothing until persisted state is loaded (a few ms), so no action
  // can run against seed data that is about to be replaced.
  if (!value) return null;
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// ---------------------------------------------------------------------------
// BACKEND

const IDLE: CoreStatus = { phase: "idle", refreshing: false, error: null, lastLoadedAt: null };
const notSignedIn = <T,>(): Result<T> => fail("UNAUTHENTICATED", "UNAUTHENTICATED");
const noWithdrawals = (): Result<never> => fail("NOT_AVAILABLE", WITHDRAWALS_UNAVAILABLE_COPY);

/** One core store per signed-in user that has an app role; disposed on sign-out/switch. */
function useCoreBackendStore(userId: string | null): CoreBackendStore | null {
  const store = useMemo(() => {
    if (!userId) return null;
    const client = getSupabaseClient();
    if (!client.ok) return null;
    return createCoreBackendStore({ userId, ops: createCoreOperations(client.value), storage: createEvidenceStorage(client.value) });
  }, [userId]);
  useEffect(() => {
    if (!store) return;
    void store.refresh();
    // Foreground: pick up changes made elsewhere (no polling).
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void store.refreshIfStale();
    });
    return () => {
      sub.remove();
      store.dispose();
    };
  }, [store]);
  return store;
}

function BackendAppProvider({ children }: { children: React.ReactNode }) {
  const { state: auth } = useAuth();
  const { role } = useSession();
  const user = auth.mode === "BACKEND" && auth.status === "authenticated" ? auth.user : null;
  const userId = user && role ? user.id : null;
  const displayName = auth.mode === "BACKEND" && auth.status === "authenticated" ? auth.profile?.displayName ?? "" : "";

  const store = useCoreBackendStore(userId);
  const subscribe = useCallback((l: () => void) => (store ? store.subscribe(l) : () => undefined), [store]);
  const core = useSyncExternalStore(subscribe, () => store?.getState() ?? null, () => store?.getState() ?? null);
  const status = useSyncExternalStore(subscribe, () => store?.getStatus() ?? IDLE, () => store?.getStatus() ?? IDLE);
  const parking = useLocalStore();

  const storeRef = useRef(store);
  storeRef.current = store;

  const value = useMemo<AppContextValue | null>(() => {
    if (!parking) return null;
    const s = store;
    const id = userId ?? "";
    const wrap = <A extends unknown[], T>(fn: (st: CoreBackendStore, ...a: A) => Promise<Result<T>>) =>
      (...a: A): Promise<Result<T>> => (s ? fn(s, ...a) : Promise.resolve(notSignedIn<T>()));
    const markRead = () => {
      if (s) void s.markNotificationsRead();
    };
    return buildValue({
      core: core ?? EMPTY_STATE,
      parking,
      citizenId: id,
      officerId: id,
      parkingOwnerId: id,
      citizenProfile: ownReporterProfile(displayName),
      base: {
        dataSource: "BACKEND",
        coreStatus: { phase: status.phase, refreshing: status.refreshing, error: status.error },
        refreshCore: async () => {
          if (s) await s.refresh();
        },
        refreshCoreIfStale: () => {
          if (s) void s.refreshIfStale();
        },
        capabilities: { withdrawals: false, demoTools: false },
        resetDemoData: noRefresh,
      },
      actions: {
        submitReport: wrap((st, draft: ReportDraft, onProgress?: (p: SubmitProgress) => void) => st.submitReport(draft, onProgress)),
        validateWithdrawal: noWithdrawals,
        withdraw: noWithdrawals,
        acceptCase: wrap((st, caseId: string) => st.acceptCase(caseId)),
        startEnRoute: wrap((st, caseId: string) => st.startEnRoute(caseId)),
        startInspection: wrap((st, caseId: string) => st.startInspection(caseId)),
        setChecklistItem: wrap((st, caseId: string, key: InspectionCheckKey, v: boolean | null) => st.setChecklistItem(caseId, CHECK_KEY_TO_DOMAIN[key], v)),
        confirmPlateBySimulatedScan: wrap((st, caseId: string) => st.confirmPlateBySimulatedScan(caseId)),
        setOfficerPhoto: wrap((st, caseId: string, key: OfficerPhotoKey, uri: string, capturedAt?: string) =>
          st.setOfficerPhoto(caseId, OFFICER_PHOTO_KEY_TO_TYPE[key], uri, capturedAt)
        ),
        completeCase: wrap((st, caseId: string, code: EnforcementOutcomeCode, notes?: string) => st.completeCase(caseId, code, notes)),
        markUserNotificationsRead: markRead,
        markOfficerNotificationsRead: markRead,
      },
    });
  }, [core, status, parking, store, userId, displayName]);

  if (!value) return null;
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { mode } = useAuth();
  return mode === "BACKEND" ? <BackendAppProvider>{children}</BackendAppProvider> : <LocalAppProvider>{children}</LocalAppProvider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

/** Run a core action and get its settled result, whether it answered synchronously or not. */
export function settle<T>(r: ActionResult<T>): Promise<Result<T>> {
  return Promise.resolve(r).catch((): Result<T> => ({ ok: false, error: { code: "BACKEND_ERROR", message: "Unexpected failure." } as DomainError }));
}
