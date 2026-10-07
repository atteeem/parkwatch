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
import { citizenReportStats, filterMyReports, MyReportsTab, selectCitizenReportById } from "../presentation/citizenViews";
import { CasesTab, casesStats, filterCasesTab, filterQueue, myCases, QueueFilter, queueSummary, sortCases } from "../presentation/officerViews";
import { EarningsPeriod, selectEarnings, selectWalletActivity, WalletActivityItem, EarningsSummary } from "../presentation/walletViews";
import { ParkingHistoryItem, parkingHistory, VehicleView, vehicleViews } from "../presentation/parkingViews";
import { ActionResult } from "../presentation/submitGuard";
import { useAuth } from "../auth/AuthContext";
import {
  createCoreBackendStore,
  CoreBackendStore,
  CoreStatus,
  ListSpec,
  startOfDay,
  startOfWeek,
  SubmitOptions,
} from "../backend/core/coreBackendStore";
import { createCoreOperations } from "../backend/operations/coreOperations";
import { createEvidenceStorage } from "../backend/storage/evidenceStorage";
import { getSupabaseClient } from "../backend/supabase";
import { asyncStorageAdapter } from "../store/asyncStorageAdapter";
import { getReporterDisplayProfile, ownReporterProfile, ReporterDisplayProfile } from "../store/reporterProfiles";
import { buildSeedState } from "../store/seed";
import { DEV_CITIZEN_ID, DEV_OFFICER_ID } from "../store/session";
import { EMPTY_STATE, ParkWatchState } from "../store/state";
import { createParkWatchStore, ParkWatchStore } from "../store/store";
import { EvidenceUrlContext } from "./EvidenceUrlContext";
import { useSession } from "./SessionContext";

// AppContext: the ONE core data boundary the screens use.
//
// * LOCAL_DEMO (no backend configured): the persisted local store (T7), with
//   the dev accounts. Actions answer synchronously; lists are complete.
// * BACKEND (Supabase configured): the server owns reports, cases,
//   inspections, rewards and notifications (src/backend/core). Actions are
//   server calls and answer asynchronously; lists are paginated and filtered
//   on the server; counts come from the server. There is NO fallback to local
//   or demo data in this mode. Parking stays local in both modes.
//
// Screens receive the same view models either way, treat every core action
// as an ActionResult (sync or Promise), and read lists through usePagedList.

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

/** A list as screens see it. In the local demo it is always complete (hasMore=false). */
export type PagedList<T> = {
  items: T[];
  loaded: boolean;
  /** A page (first or next) is loading. */
  loading: boolean;
  hasMore: boolean;
  error: DomainError | null;
};

export type AppListSpec =
  | { kind: "citizenReports"; tab: MyReportsTab }
  | { kind: "notifications"; role: "CITIZEN" | "OFFICER" }
  | { kind: "queue"; filter: QueueFilter }
  | { kind: "myCases"; tab: CasesTab };

/** Counts for the citizen screens (server-side in BACKEND mode; never from a loaded page). */
export type CitizenSummary = {
  total: number;
  underReview: number;
  verified: number;
  rejected: number;
  weekSubmitted: number;
  weekVerified: number;
  weekRejected: number;
  unread: number;
};

export type OfficerSummary = {
  open: number;
  newCount: number;
  highPriorityNew: number;
  highPriorityOpen: number;
  assignedToMe: number;
  mineTotal: number;
  mineCompleted: number;
  mineIssued: number;
  mineRejected: number;
  todayCompleted: number;
  todayIssued: number;
  todayRejected: number;
  unread: number;
};

const appStore: ParkWatchStore = createParkWatchStore({
  storage: asyncStorageAdapter,
  seed: buildSeedState,
  onPersistError: (e) => console.warn("[ParkWatch] failed to persist state", e),
  onDiscard: (reason) => console.warn(`[ParkWatch] discarded persisted state (${reason}); reseeding`),
});

type AppContextValue = {
  dataSource: DataSource;
  coreStatus: CoreDataStatus;
  /** Re-load the core data now (pull-to-refresh, Retry): page 1 of every list. No-op in LOCAL_DEMO. */
  refreshCore: () => Promise<void>;
  /** Screen focus / foreground: refresh unless the data is very fresh. No-op in LOCAL_DEMO. */
  refreshCoreIfStale: () => void;
  capabilities: AppCapabilities;

  // lists + counts
  getList: <T extends AppListSpec>(spec: T) => PagedList<ListItem<T>>;
  ensureList: (spec: AppListSpec) => void;
  loadMore: (spec: AppListSpec) => void;
  citizenSummary: CitizenSummary;
  officerSummary: OfficerSummary;
  /** Officer position for "nearest first" server ordering (BACKEND; used on the next refresh). */
  setQueuePosition: (pos: { latitude: number; longitude: number } | null) => void;
  /** A detail screen opened this case/report: load it (BACKEND) so it is current even if no page holds it. */
  ensureCase: (caseId: string) => void;
  ensureReport: (reportId: string) => void;
  /** true while a case/report is being fetched for the first time (show loading, not "not found"). */
  isCaseLoading: (caseId: string) => boolean;
  isReportLoading: (reportId: string) => boolean;

  // citizen
  userReports: UserReport[];
  /** Read-only lookup for detail screens / deep links (null if unknown or not this citizen's). */
  getCitizenReport: (id: string | undefined | null) => UserReport | null;
  /** Display profile of the signed-in citizen. */
  citizenProfile: ReporterDisplayProfile;
  /** Submit the draft. Idempotent per draftId: a repeat returns the same report (created=false). */
  submitReport: (draft: ReportDraft, opts?: SubmitOptions) => ActionResult<{ reportId: string; created: boolean }>;
  /** Clean up the uploads of a discarded unsent draft (BACKEND; no-op locally). */
  abandonSubmission: (paths: readonly string[]) => Promise<void>;
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
  /** Every case currently known on this device (BACKEND: the loaded pages and details only). */
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

export type ListItem<T extends AppListSpec> = T extends { kind: "citizenReports" }
  ? UserReport
  : T extends { kind: "notifications" }
    ? Notification
    : OfficerCase;

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
  | "abandonSubmission"
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

type ListAccess = Pick<
  AppContextValue,
  "getList" | "ensureList" | "loadMore" | "citizenSummary" | "officerSummary" | "setQueuePosition" | "ensureCase" | "ensureReport" | "isCaseLoading" | "isReportLoading"
>;

type Derived = {
  now: Date;
  userReports: UserReport[];
  officerCases: OfficerCase[];
  userNotifications: Notification[];
  officerNotifications: Notification[];
};

/** Everything derived from core state with the same selectors in both modes. */
function buildValue(args: {
  core: ParkWatchState;
  derived: Derived;
  parking: ParkWatchState;
  citizenId: string;
  officerId: string;
  parkingOwnerId: string;
  citizenProfile: ReporterDisplayProfile;
  actions: CoreActions;
  lists: ListAccess;
  base: Pick<AppContextValue, "dataSource" | "coreStatus" | "refreshCore" | "refreshCoreIfStale" | "capabilities" | "resetDemoData">;
}): AppContextValue {
  const { core, parking, citizenId, officerId, parkingOwnerId, derived } = args;
  const { now, officerCases } = derived;
  const wallet = selectWallet(core, citizenId);
  return {
    ...args.base,
    ...args.actions,
    ...args.lists,
    userReports: derived.userReports,
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

    userNotifications: derived.userNotifications,
    officerNotifications: derived.officerNotifications,
  };
}

function derive(core: ParkWatchState, citizenId: string, officerId: string): Derived {
  const now = new Date();
  return {
    now,
    userReports: selectCitizenReports(core, citizenId),
    officerCases: selectOfficerCases(core, now),
    userNotifications: selectNotifications(core, { role: "CITIZEN", accountId: citizenId }, now),
    officerNotifications: selectNotifications(core, { role: "OFFICER", accountId: officerId }, now),
  };
}

const complete = <T,>(items: T[]): PagedList<T> => ({ items, loaded: true, loading: false, hasMore: false, error: null });

// ---------------------------------------------------------------------------
// LOCAL_DEMO

const READY: CoreDataStatus = { phase: "ready", refreshing: false, error: null };
const noRefresh = () => Promise.resolve();
const noop = () => undefined;

function LocalAppProvider({ children }: { children: React.ReactNode }) {
  useEffect(registerDevTools, []);
  const state = useLocalStore();

  const value = useMemo<AppContextValue | null>(() => {
    if (!state) return null;
    const citizen = { role: "CITIZEN" as const, accountId: DEV_CITIZEN_ID };
    const officer = { role: "OFFICER" as const, accountId: DEV_OFFICER_ID };
    const derived = derive(state, DEV_CITIZEN_ID, DEV_OFFICER_ID);
    const { userReports, officerCases } = derived;
    const mine = myCases(officerCases, DEV_OFFICER_ID);
    const today = new Date(derived.now).toDateString();
    const todays = casesStats(mine.filter((c) => c.completedAt && new Date(c.completedAt).toDateString() === today));
    const all = citizenReportStats(userReports);
    const week = citizenReportStats(userReports, startOfWeek(derived.now));
    const qs = queueSummary(officerCases, DEV_OFFICER_ID);
    const open = filterQueue(officerCases.map((c) => ({ ...c, distanceMeters: null })), "All", DEV_OFFICER_ID);
    const ms = casesStats(mine);

    // The local store is complete: every list is one finished "page", filtered with the T7 rules.
    const getList = ((spec: AppListSpec) => {
      switch (spec.kind) {
        case "citizenReports":
          return complete(filterMyReports(userReports, spec.tab));
        case "notifications":
          return complete(spec.role === "CITIZEN" ? derived.userNotifications : derived.officerNotifications);
        case "queue":
          return complete(filterQueue(officerCases.map((c) => ({ ...c, distanceMeters: null })), spec.filter, DEV_OFFICER_ID));
        case "myCases":
          return complete(sortCases(filterCasesTab(mine, spec.tab), "NEWEST"));
      }
    }) as AppContextValue["getList"];

    return buildValue({
      core: state,
      derived,
      parking: state,
      citizenId: DEV_CITIZEN_ID,
      officerId: DEV_OFFICER_ID,
      parkingOwnerId: DEV_CITIZEN_ID,
      citizenProfile: getReporterDisplayProfile(DEV_CITIZEN_ID),
      base: {
        dataSource: "LOCAL_DEMO",
        coreStatus: READY,
        refreshCore: noRefresh,
        refreshCoreIfStale: noop,
        capabilities: { withdrawals: true, demoTools: true },
        resetDemoData,
      },
      lists: {
        getList,
        ensureList: noop,
        loadMore: noop,
        setQueuePosition: noop,
        ensureCase: noop,
        ensureReport: noop,
        isCaseLoading: () => false,
        isReportLoading: () => false,
        citizenSummary: {
          total: all.submitted,
          underReview: userReports.filter((r) => r.status === "under-review").length,
          verified: all.verified,
          rejected: all.rejected,
          weekSubmitted: week.submitted,
          weekVerified: week.verified,
          weekRejected: week.rejected,
          unread: derived.userNotifications.filter((n) => n.unread).length,
        },
        officerSummary: {
          open: open.length,
          newCount: qs.newCount,
          highPriorityNew: qs.highPriorityCount,
          highPriorityOpen: open.filter((c) => c.priority === "high").length,
          assignedToMe: qs.assignedToMeCount,
          mineTotal: ms.total,
          mineCompleted: ms.completed,
          mineIssued: ms.issued,
          mineRejected: ms.rejected,
          todayCompleted: todays.completed,
          todayIssued: todays.issued,
          todayRejected: todays.rejected,
          unread: derived.officerNotifications.filter((n) => n.unread).length,
        },
      },
      actions: {
        submitReport: (draft) => appStore.submitReport(draft, DEV_CITIZEN_ID),
        abandonSubmission: noRefresh,
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

const notSignedIn = <T,>(): Result<T> => fail("UNAUTHENTICATED", "UNAUTHENTICATED");
const noWithdrawals = (): Result<never> => fail("NOT_AVAILABLE", WITHDRAWALS_UNAVAILABLE_COPY);

const QUEUE_FILTER_KEY = { All: "all", New: "new", "High Priority": "high", Assigned: "assigned" } as const;
const CASES_TAB_KEY = { All: "all", Completed: "completed", Issued: "issued", Rejected: "rejected" } as const;
const REPORT_TAB_STATUS = { all: null, "under-review": "UNDER_REVIEW", verified: "VERIFIED", rejected: "REJECTED" } as const;

export function toStoreSpec(spec: AppListSpec): ListSpec {
  switch (spec.kind) {
    case "citizenReports":
      return { kind: "reports", status: REPORT_TAB_STATUS[spec.tab] };
    case "notifications":
      return { kind: "notifications" };
    case "queue":
      return { kind: "queue", filter: QUEUE_FILTER_KEY[spec.filter] };
    case "myCases":
      return { kind: "cases", tab: CASES_TAB_KEY[spec.tab] };
  }
}

const ZERO_CITIZEN: CitizenSummary = { total: 0, underReview: 0, verified: 0, rejected: 0, weekSubmitted: 0, weekVerified: 0, weekRejected: 0, unread: 0 };
const ZERO_OFFICER: OfficerSummary = {
  open: 0,
  newCount: 0,
  highPriorityNew: 0,
  highPriorityOpen: 0,
  assignedToMe: 0,
  mineTotal: 0,
  mineCompleted: 0,
  mineIssued: 0,
  mineRejected: 0,
  todayCompleted: 0,
  todayIssued: 0,
  todayRejected: 0,
  unread: 0,
};

/** One core store per signed-in user with an app role; disposed on sign-out/switch. */
function useCoreBackendStore(userId: string | null, role: "citizen" | "officer" | null, onUnauthenticated: () => void): CoreBackendStore | null {
  const unauthRef = useRef(onUnauthenticated);
  unauthRef.current = onUnauthenticated;
  const store = useMemo(() => {
    if (!userId || !role) return null;
    const client = getSupabaseClient();
    if (!client.ok) return null;
    return createCoreBackendStore({
      userId,
      role,
      ops: createCoreOperations(client.value),
      storage: createEvidenceStorage(client.value),
      onUnauthenticated: () => unauthRef.current(),
    });
  }, [userId, role]);
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
  const { state: auth, refreshProfile } = useAuth();
  const { role } = useSession();
  const user = auth.mode === "BACKEND" && auth.status === "authenticated" ? auth.user : null;
  const userId = user && role ? user.id : null;
  const displayName = auth.mode === "BACKEND" && auth.status === "authenticated" ? auth.profile?.displayName ?? "" : "";

  // The server refused the session: re-check it (the auth layer signs out with a notice if it is gone).
  const lastCheck = useRef(0);
  const onUnauthenticated = useCallback(() => {
    if (Date.now() - lastCheck.current < 10_000) return;
    lastCheck.current = Date.now();
    void refreshProfile();
  }, [refreshProfile]);

  const store = useCoreBackendStore(userId, role, onUnauthenticated);
  const subscribe = useCallback((l: () => void) => (store ? store.subscribe(l) : () => undefined), [store]);
  const version = useSyncExternalStore(subscribe, () => store?.getVersion() ?? -1, () => store?.getVersion() ?? -1);
  const parking = useLocalStore();

  const value = useMemo<AppContextValue | null>(() => {
    if (!parking) return null;
    const s = store;
    const id = userId ?? "";
    const core = s?.getState() ?? EMPTY_STATE;
    const status = s?.getStatus() ?? { phase: "idle" as const, refreshing: false, error: null };
    const summary = s?.getSummary() ?? null;
    const derived = derive(core, id, id);
    const reportsById = new Map(derived.userReports.map((r) => [r.id, r]));
    const casesById = new Map(derived.officerCases.map((c) => [c.id, c]));
    const notifs = role === "officer" ? derived.officerNotifications : derived.userNotifications;
    const notifsById = new Map(notifs.map((n) => [n.id, n]));

    const getList = ((spec: AppListSpec) => {
      const l = s ? s.getList(toStoreSpec(spec)) : { ids: [], loaded: false, loading: false, hasMore: false, error: null };
      const pick = <T,>(m: Map<string, T>) => l.ids.map((x) => m.get(x)).filter((x): x is T => x !== undefined);
      const items = spec.kind === "citizenReports" ? pick(reportsById) : spec.kind === "notifications" ? pick(notifsById) : pick(casesById);
      return { items, loaded: l.loaded, loading: l.loading, hasMore: l.hasMore, error: l.error };
    }) as AppContextValue["getList"];

    const cs = summary?.kind === "citizen" ? summary.row : null;
    const os = summary?.kind === "officer" ? summary.row : null;
    const wrap = <A extends unknown[], T>(fn: (st: CoreBackendStore, ...a: A) => Promise<Result<T>>) =>
      (...a: A): Promise<Result<T>> => (s ? fn(s, ...a) : Promise.resolve(notSignedIn<T>()));
    const markRead = () => {
      if (s) void s.markNotificationsRead();
    };
    void version; // re-derive on every store change

    return buildValue({
      core,
      derived,
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
      lists: {
        getList,
        ensureList: (spec) => s?.ensureList(toStoreSpec(spec)),
        loadMore: (spec) => s?.loadMore(toStoreSpec(spec)),
        setQueuePosition: (pos) => s?.setQueuePosition(pos ? { lat: pos.latitude, lng: pos.longitude } : null),
        ensureCase: (caseId) => s?.ensureCase(caseId),
        ensureReport: (reportId) => s?.ensureReport(reportId),
        isCaseLoading: (caseId) => s?.getCaseLoad(caseId) === "loading",
        isReportLoading: (reportId) => s?.getReportLoad(reportId) === "loading",
        citizenSummary: cs
          ? {
              total: cs.total,
              underReview: cs.under_review,
              verified: cs.verified,
              rejected: cs.rejected,
              weekSubmitted: cs.since_total,
              weekVerified: cs.since_verified,
              weekRejected: cs.since_rejected,
              unread: cs.unread_notifications,
            }
          : ZERO_CITIZEN,
        officerSummary: os
          ? {
              open: os.open,
              newCount: os.new,
              highPriorityNew: os.high_new,
              highPriorityOpen: os.high_open,
              assignedToMe: os.assigned_to_me,
              mineTotal: os.mine_total,
              mineCompleted: os.mine_completed,
              mineIssued: os.mine_issued,
              mineRejected: os.mine_rejected,
              todayCompleted: os.since_completed,
              todayIssued: os.since_issued,
              todayRejected: os.since_rejected,
              unread: os.unread_notifications,
            }
          : ZERO_OFFICER,
      },
      actions: {
        submitReport: wrap((st, draft: ReportDraft, opts?: SubmitOptions) => st.submitReport(draft, opts)),
        abandonSubmission: async (paths) => {
          if (s) await s.abandonSubmission(paths);
        },
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
  }, [version, parking, store, userId, role, displayName]);

  const refreshEvidenceUrl = useCallback(async (url: string) => (store ? store.refreshSignedUrl(url) : false), [store]);

  if (!value) return null;
  return (
    <AppContext.Provider value={value}>
      <EvidenceUrlContext.Provider value={refreshEvidenceUrl}>{children}</EvidenceUrlContext.Provider>
    </AppContext.Provider>
  );
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

/** A list screen: loads page 1 when shown (BACKEND), and returns the list plus "load more". */
export function usePagedList<T extends AppListSpec>(spec: T): PagedList<ListItem<T>> & { loadMore: () => void } {
  const app = useApp();
  const key = JSON.stringify(spec);
  const appRef = useRef(app);
  appRef.current = app;
  // Once per shown list (and when the filter/tab changes or the account/store changes),
  // not on every data change.
  useEffect(() => {
    appRef.current.ensureList(spec);
  }, [key, app.dataSource, app.officerId]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...app.getList(spec), loadMore: () => app.loadMore(spec) };
}

/** A case detail screen: (re)load the case when shown (BACKEND). */
export function useCaseDetailLoad(caseId: string | undefined | null): { loading: boolean } {
  const app = useApp();
  useEffect(() => {
    if (caseId) app.ensureCase(caseId);
  }, [caseId]); // eslint-disable-line react-hooks/exhaustive-deps
  return { loading: !!caseId && app.isCaseLoading(caseId) };
}

/** A citizen report screen: (re)load the report when shown (BACKEND). */
export function useReportDetailLoad(reportId: string | undefined | null): { loading: boolean } {
  const app = useApp();
  useEffect(() => {
    if (reportId) app.ensureReport(reportId);
  }, [reportId]); // eslint-disable-line react-hooks/exhaustive-deps
  return { loading: !!reportId && app.isReportLoading(reportId) };
}

/** Run a core action and get its settled result, whether it answered synchronously or not. */
export function settle<T>(r: ActionResult<T>): Promise<Result<T>> {
  return Promise.resolve(r).catch((): Result<T> => ({ ok: false, error: { code: "BACKEND_ERROR", message: "Unexpected failure." } as DomainError }));
}

/** Officer screens: tell the server queue where the officer is (rounded to ~100 m), for "nearest first". */
export function useQueuePosition(fix: { latitude: number; longitude: number } | undefined | null) {
  const app = useApp();
  const lat = fix ? Math.round(fix.latitude * 1000) / 1000 : null;
  const lng = fix ? Math.round(fix.longitude * 1000) / 1000 : null;
  useEffect(() => {
    app.setQueuePosition(lat !== null && lng !== null ? { latitude: lat, longitude: lng } : null);
  }, [lat, lng]); // eslint-disable-line react-hooks/exhaustive-deps
}
