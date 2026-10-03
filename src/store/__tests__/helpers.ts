import { completeDraft } from "../../domain/__tests__/fixtures";
import { ReportDraft } from "../../domain";
import { createMemoryStorage } from "../persistence";
import { EMPTY_STATE, ParkWatchState } from "../state";
import { createParkWatchStore } from "../store";

export const NOW = new Date("2026-07-17T18:00:00.000Z");
export const CITIZEN = "citizen-test";
export const OFFICER = "officer-test";

/** A store on in-memory storage with a controllable clock. */
export async function makeStore(opts: { seed?: (now: Date) => ParkWatchState; storage?: ReturnType<typeof createMemoryStorage> } = {}) {
  let t = NOW.getTime();
  const storage = opts.storage ?? createMemoryStorage();
  const store = createParkWatchStore({
    storage,
    seed: opts.seed ?? (() => ({ ...EMPTY_STATE })),
    clock: () => new Date(t),
  });
  await store.hydrate();
  return {
    store,
    storage,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

export const draft = (draftId: string): ReportDraft => completeDraft(draftId);

export function snapshot(store: { getSnapshot: () => ParkWatchState | null }): ParkWatchState {
  const s = store.getSnapshot();
  if (!s) throw new Error("store not hydrated");
  return s;
}

/** Submit a report and drive its case to INSPECTION with a complete inspection. */
export function submitAndInspect(
  store: Awaited<ReturnType<typeof makeStore>>["store"],
  draftId: string,
  opts: { photos?: boolean; checks?: boolean } = { photos: true, checks: true }
) {
  const submitted = store.submitReport(draft(draftId), CITIZEN);
  if (!submitted.ok) throw new Error(submitted.error.message);
  const caseId = `c-${submitted.value.reportId}`;
  expectOk(store.acceptCase(caseId, OFFICER));
  expectOk(store.startInspection(caseId, OFFICER));
  if (opts.checks !== false) {
    for (const key of ["vehiclePresent", "plateMatches", "violationConfirmed", "restrictionVerified"] as const) {
      expectOk(store.updateChecklist(caseId, key, true));
    }
  }
  if (opts.photos !== false) {
    for (const type of ["VEHICLE_OVERVIEW", "LICENSE_PLATE", "PARKING_SIGN", "VIOLATION_CONTEXT"] as const) {
      expectOk(store.attachOfficerPhoto(caseId, type, `file:///${draftId}-${type}.jpg`));
    }
  }
  return { reportId: submitted.value.reportId, caseId };
}

export function expectOk<T>(r: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!r.ok) throw new Error(`Expected ok, got ${r.error.code}: ${r.error.message}`);
  return r.value;
}
