// Server-backed core data for ONE signed-in user (T8.3).
//
// - The server owns the data. This store keeps the latest RLS-limited
//   snapshot (as domain state, so all selectors work) and a status.
// - Refresh: initial load, screen focus, app foreground and after every
//   mutation. No polling. Concurrent refresh requests share one request.
// - Mutations call server functions; on success the store refreshes. A
//   failed mutation never changes local data (nothing optimistic).
// - Photos: uploaded to private buckets before the server call, removed
//   again if the server call fails; shown through short-lived signed URLs.

import {
  ChecklistKey,
  CitizenEvidence,
  DomainError,
  EnforcementOutcomeCode,
  fail,
  MVP_MOCK_DETECTED_VEHICLE,
  OfficerEvidenceType,
  ok,
  ReportDraft,
  Result,
} from "../../domain";

import { ParkWatchState } from "../../store/state";
import { parseStorageUri } from "../mappers/common";
import { CoreSnapshotRows, normalizeSnapshot, snapshotToState, storagePathsOf } from "../mappers/snapshot";
import { CoreOperations, SubmitEvidenceInput } from "../operations/coreOperations";
import { EVIDENCE_BUCKETS, EvidenceStorage, imageTypeOf, officerEvidencePath, reportEvidencePath, SIGNED_URL_TTL_SECONDS } from "../storage/evidenceStorage";

export type CorePhase = "idle" | "loading" | "ready" | "error";

export type CoreStatus = {
  phase: CorePhase;
  /** A refresh is running while data is already shown. */
  refreshing: boolean;
  /** Last refresh failure (data may still be shown from before). */
  error: DomainError | null;
  lastLoadedAt: number | null;
};

export type SubmitProgress = "uploading" | "submitting";

export type CoreBackendStore = ReturnType<typeof createCoreBackendStore>;

type Deps = {
  userId: string;
  ops: CoreOperations;
  storage: EvidenceStorage;
  now?: () => Date;
  /** Skip a focus refresh if the last one is younger than this. */
  minFocusRefreshMs?: number;
};

const REQUIRED_SLOTS = ["FRONT", "SIDE", "REAR"] as const;

export function createCoreBackendStore({ userId, ops, storage, now = () => new Date(), minFocusRefreshMs = 5000 }: Deps) {
  let state: ParkWatchState | null = null;
  let rows: CoreSnapshotRows = normalizeSnapshot(null);
  let status: CoreStatus = { phase: "idle", refreshing: false, error: null, lastLoadedAt: null };
  let inflight: Promise<Result<true>> | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();
  /** bucket/path -> { url, expiresAt } */
  const signed = new Map<string, { url: string; expiresAt: number }>();

  const emit = () => listeners.forEach((l) => l());
  const setStatus = (patch: Partial<CoreStatus>) => {
    status = { ...status, ...patch };
    emit();
  };

  async function signAll(snapshot: CoreSnapshotRows) {
    const t = now().getTime();
    const margin = 5 * 60 * 1000; // re-sign anything expiring within 5 minutes
    const paths = storagePathsOf(snapshot);
    for (const [bucket, list] of [
      [EVIDENCE_BUCKETS.citizen, paths.report],
      [EVIDENCE_BUCKETS.officer, paths.officer],
    ] as const) {
      const need = list.filter((p) => {
        const hit = signed.get(`${bucket}/${p}`);
        return !hit || hit.expiresAt - margin < t;
      });
      if (need.length === 0) continue;
      const urls = await storage.sign(bucket, need);
      for (const [p, url] of Object.entries(urls)) signed.set(`${bucket}/${p}`, { url, expiresAt: t + SIGNED_URL_TTL_SECONDS * 1000 });
    }
  }

  const resolveUri = (uri: string) => {
    const ref = parseStorageUri(uri);
    if (!ref) return uri;
    return signed.get(`${ref.bucket}/${ref.path}`)?.url ?? uri;
  };

  function refresh(): Promise<Result<true>> {
    if (inflight) return inflight;
    const first = state === null;
    setStatus(first ? { phase: "loading", error: null } : { refreshing: true });
    inflight = (async () => {
      const r = await ops.getSnapshot();
      if (disposed) return fail<true>("UNAUTHENTICATED", "UNAUTHENTICATED");
      if (!r.ok) {
        setStatus({ phase: state ? "ready" : "error", refreshing: false, error: r.error });
        return r;
      }
      rows = normalizeSnapshot(r.value);
      await signAll(rows);
      if (disposed) return fail<true>("UNAUTHENTICATED", "UNAUTHENTICATED");
      state = snapshotToState(rows, resolveUri);
      status = { phase: "ready", refreshing: false, error: null, lastLoadedAt: now().getTime() };
      emit();
      return ok(true as const);
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  /** After a successful mutation: refresh, but the mutation's own result stands even if the refresh fails. */
  async function thenRefresh<T>(r: Result<T>): Promise<Result<T>> {
    if (r.ok) await refresh();
    return r;
  }

  // ---------------------------------------------------------------------------
  // Citizen: submit (upload photos -> server function -> refresh)

  async function submitReport(draft: ReportDraft, onProgress?: (p: SubmitProgress) => void): Promise<Result<{ reportId: string; created: boolean }>> {
    const photos = REQUIRED_SLOTS.map((slot) => draft.photos[slot]).filter((p): p is CitizenEvidence => !!p);
    if (photos.length !== 3 || !draft.violationId || !draft.location.address.trim()) return fail("INVALID_DRAFT", "INVALID_DRAFT");
    const all = [...photos.map((p) => ({ ev: p, slot: p.type as SubmitEvidenceInput["slot"] })), ...draft.attachments.map((a) => ({ ev: a, slot: "ATTACHMENT" as const }))];
    const items = all.map(({ ev, slot }) => ({
      ev,
      slot,
      path: reportEvidencePath(userId, draft.draftId, ev.id, imageTypeOf(ev.uri).ext),
    }));

    onProgress?.("uploading");
    const uploaded: string[] = [];
    for (const it of items) {
      const u = await storage.upload(EVIDENCE_BUCKETS.citizen, it.path, it.ev.uri);
      if (!u.ok) {
        await storage.remove(EVIDENCE_BUCKETS.citizen, uploaded);
        return u;
      }
      uploaded.push(it.path);
    }

    onProgress?.("submitting");
    const at = now().toISOString();
    const vehicle = draft.vehicle ?? MVP_MOCK_DETECTED_VEHICLE;
    const coords = draft.location.coordinates;
    const r = await ops.submitReport({
      submissionId: draft.draftId,
      violationType: draft.violationId,
      locationAddress: draft.location.address.trim(),
      observedAt: draft.observedAt ?? photos[0].capturedAt,
      submittedAt: at,
      evidence: items.map((it) => ({ slot: it.slot, capture_source: it.ev.captureSource, storage_path: it.path, captured_at: it.ev.capturedAt })),
      notes: draft.notes,
      latitude: coords?.latitude,
      longitude: coords?.longitude,
      locationAccuracyM: coords?.accuracyMeters,
      locationCapturedAt: coords?.capturedAt,
      plateRaw: vehicle.plate.raw,
      plateNormalized: vehicle.plate.normalized,
      plateCountry: vehicle.plate.country,
      vehicleMake: vehicle.make,
      vehicleModel: vehicle.model,
      vehicleColor: vehicle.color,
      vehicleSource: vehicle.source,
    });
    if (!r.ok) {
      // Remove what this attempt uploaded. If the server did create the report
      // (lost response), its evidence is attached and the server refuses the
      // delete, so a retry with the same submission id still finds it.
      await storage.remove(EVIDENCE_BUCKETS.citizen, uploaded);
      return r;
    }
    await refresh();
    return ok({ reportId: String(r.value.publicReportNumber), created: r.value.created });
  }

  // ---------------------------------------------------------------------------
  // Officer

  async function setOfficerPhoto(caseId: string, type: OfficerEvidenceType, uri: string, capturedAt?: string): Promise<Result<{ evidenceId: string }>> {
    const previous = rows.officer_evidence.find((e) => e.case_id === caseId && e.evidence_type === type)?.storage_path;
    const captureId = `${type}-${now().getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const path = officerEvidencePath(caseId, captureId, imageTypeOf(uri).ext);
    const u = await storage.upload(EVIDENCE_BUCKETS.officer, path, uri);
    if (!u.ok) return u;
    const r = await ops.addOfficerEvidence(caseId, type, path, capturedAt ?? now().toISOString());
    if (!r.ok) {
      await storage.remove(EVIDENCE_BUCKETS.officer, [path]);
      return r;
    }
    // The retaken photo replaced the old one; the old object is now unattached.
    if (previous && previous !== path) await storage.remove(EVIDENCE_BUCKETS.officer, [previous]);
    return thenRefresh(r);
  }

  const voidify = async (p: Promise<Result<unknown>>): Promise<Result<void>> => {
    const r = await thenRefresh(await p);
    return r.ok ? ok(undefined) : r;
  };

  return {
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getState: () => state,
    getStatus: () => status,
    refresh,
    /** Focus/foreground refresh: skipped if data is very fresh. */
    refreshIfStale() {
      if (status.lastLoadedAt !== null && now().getTime() - status.lastLoadedAt < minFocusRefreshMs) return Promise.resolve(ok(true as const));
      return refresh();
    },
    /** Sign-out / account switch: drop everything so nothing leaks to the next account. */
    dispose() {
      disposed = true;
      state = null;
      rows = normalizeSnapshot(null);
      signed.clear();
      listeners.clear();
    },

    submitReport,
    acceptCase: (caseId: string) => voidify(ops.acceptCase(caseId)),
    startEnRoute: (caseId: string) => voidify(ops.startEnRoute(caseId)),
    startInspection: (caseId: string) => voidify(ops.startInspection(caseId)),
    setChecklistItem: (caseId: string, key: ChecklistKey, value: boolean | null) => voidify(ops.setInspectionCheck(caseId, key, value)),
    confirmPlateBySimulatedScan: (caseId: string) => voidify(ops.confirmPlateByScan(caseId)),
    setOfficerPhoto,
    async completeCase(caseId: string, code: EnforcementOutcomeCode, notes?: string): Promise<Result<{ changed: boolean }>> {
      const r = await thenRefresh(await ops.completeCase(caseId, code, notes));
      return r.ok ? ok({ changed: r.value.changed }) : r;
    },
    async markNotificationsRead(): Promise<Result<void>> {
      const unread = state?.notifications.some((n) => n.recipient.accountId === userId && !n.readAt);
      if (!unread) return ok(undefined);
      return voidify(ops.markMyNotificationsRead());
    },
  };
}
