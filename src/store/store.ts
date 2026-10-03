import { ChecklistKey, EnforcementOutcomeCode, fail, Notification, OfficerEvidenceType, ReportDraft, Result } from "../domain";
import * as commands from "./commands";
import { CommandResult } from "./commands";
import { deserializeState, KeyValueStorage, PERSIST_KEY, serializeState } from "./persistence";
import { ParkWatchState } from "./state";

export type Clock = () => Date;

export type StoreOptions = {
  storage: KeyValueStorage;
  /** Build fresh seed state; called on first run, after discard, and on dev reset. */
  seed: (now: Date) => ParkWatchState;
  clock?: Clock;
  onPersistError?: (error: unknown) => void;
  onDiscard?: (reason: string) => void;
};

export type HydrationSource = "storage" | "seed";

/**
 * Framework-independent ParkWatch store.
 *
 * - Holds one ParkWatchState snapshot (replaced, never mutated).
 * - Actions run a pure command synchronously against the CURRENT state, so
 *   rapid repeated calls (double taps) see each other's effects and domain
 *   idempotency holds.
 * - Every successful change is persisted (writes are serialised in order).
 * - React binds via subscribe/getSnapshot (useSyncExternalStore).
 */
export function createParkWatchStore(options: StoreOptions) {
  const clock = options.clock ?? (() => new Date());
  let state: ParkWatchState | null = null;
  const listeners = new Set<() => void>();
  let writes: Promise<void> = Promise.resolve();

  const now = () => clock().toISOString();

  function setState(next: ParkWatchState) {
    if (next === state) return;
    state = next;
    persist(next);
    listeners.forEach((l) => l());
  }

  function persist(snapshot: ParkWatchState) {
    const payload = serializeState(snapshot, now());
    writes = writes
      .then(() => options.storage.setItem(PERSIST_KEY, payload))
      .catch((e) => options.onPersistError?.(e));
  }

  function run<T>(command: (s: ParkWatchState) => CommandResult<T>): Result<T> {
    if (!state) return fail("NOT_FOUND", "Store is not hydrated yet.");
    const r = command(state);
    if (!r.ok) return r;
    setState(r.value.state);
    return { ok: true, value: r.value.value };
  }

  return {
    /** Load persisted state, or seed if there is none / it is unusable. */
    async hydrate(): Promise<HydrationSource> {
      let raw: string | null = null;
      try {
        raw = await options.storage.getItem(PERSIST_KEY);
      } catch (e) {
        options.onPersistError?.(e);
      }
      const loaded = deserializeState(raw);
      if (loaded.status === "ok") {
        state = loaded.state;
        listeners.forEach((l) => l());
        return "storage";
      }
      if (loaded.status === "discarded") options.onDiscard?.(loaded.reason);
      setState(options.seed(clock()));
      return "seed";
    },

    isHydrated: () => state !== null,
    /** Current snapshot (null before hydration). Stable between changes. */
    getSnapshot: (): ParkWatchState | null => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Resolves when all pending writes have reached storage. */
    flush: () => writes,

    /** DEV ONLY: wipe persisted mock data and reseed. */
    async resetToSeed() {
      await writes;
      await options.storage.removeItem(PERSIST_KEY);
      setState(options.seed(clock()));
      await writes;
    },

    // --- actions -----------------------------------------------------------
    submitReport: (draft: ReportDraft, citizenId: string) =>
      run((s) => commands.submitReport(s, { draft, citizenId, at: now() })),

    acceptCase: (caseId: string, officerId: string) =>
      run((s) => commands.acceptCase(s, { caseId, officerId, at: now() })),

    startEnRoute: (caseId: string, officerId: string) =>
      run((s) => commands.startEnRoute(s, { caseId, officerId, at: now() })),

    startInspection: (caseId: string, officerId: string) =>
      run((s) => commands.startInspection(s, { caseId, officerId, at: now() })),

    ensureInspection: (caseId: string) => run((s) => commands.ensureInspection(s, { caseId, at: now() })),

    updateChecklist: (caseId: string, key: ChecklistKey, value: boolean | null) =>
      run((s) => commands.updateChecklist(s, { caseId, key, value })),

    attachOfficerPhoto: (caseId: string, type: OfficerEvidenceType, uri: string) =>
      run((s) => commands.attachOfficerPhoto(s, { caseId, type, uri, at: now() })),

    updateInspectionNotes: (caseId: string, notes: string) =>
      run((s) => commands.updateInspectionNotes(s, { caseId, notes })),

    completeCase: (caseId: string, code: EnforcementOutcomeCode, officerId: string, notes?: string) =>
      run((s) => commands.completeCase(s, { caseId, code, officerId, notes, at: now() })),

    requestWithdrawal: (citizenId: string, amountCents: number, withdrawalId?: string) =>
      run((s) => commands.requestCitizenWithdrawal(s, { citizenId, amountCents, withdrawalId, at: now() })),

    markNotificationsRead: (recipient: Notification["recipient"]) =>
      run((s) => commands.markRead(s, { recipient, at: now() })),
  };
}

export type ParkWatchStore = ReturnType<typeof createParkWatchStore>;
