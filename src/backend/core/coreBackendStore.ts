// Server-backed core data for ONE signed-in user (T8.3, paginated in T8.4).
//
// - The server owns the data. This store keeps a merged cache of the rows
//   the user has loaded (pages, case/report details, own ledger), the
//   server-side summary counts, and the page state of every list screen.
//   The cache is exposed as domain state, so all selectors keep working.
// - Lists are filtered and ordered on the server BEFORE paging; a list shows
//   only the ids of its own pages (never "page 1 filtered on the client").
// - Refresh (first load, screen change, foreground, pull-to-refresh, after
//   every action): summary + ledger + page 1 of every list in use (stale
//   cursors are dropped) + open details. No polling. Concurrent refreshes
//   share one request.
// - Mutations call server functions. A network failure is AMBIGUOUS (the
//   server may have committed): the store re-reads the case and reports
//   success if the change is already there, instead of a fake failure.
// - Photos: uploaded to private buckets with deterministic paths; upload
//   progress is reported so a retry (even after a restart) skips finished
//   uploads. Shown through short-lived signed URLs, re-signed when they expire.

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
import { snapshotToState, storagePathsOf } from "../mappers/snapshot";
import {
  CasesTabKey,
  CitizenSummaryRow,
  CoreOperations,
  KeysetCursor,
  OfficerSummaryRow,
  PageBundle,
  QueueFilterKey,
  ReportStatusFilter,
  SubmitEvidenceInput,
} from "../operations/coreOperations";
import { EVIDENCE_BUCKETS, EvidenceBucket, EvidenceStorage, imageTypeOf, officerEvidencePath, reportEvidencePath, SIGNED_URL_TTL_SECONDS } from "../storage/evidenceStorage";
import { cacheToRows, dropCase, emptyCache, mergeBundle, replaceLedger, RowCache } from "./rowCache";

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

export type ListSpec =
  | { kind: "reports"; status: ReportStatusFilter }
  | { kind: "notifications" }
  | { kind: "queue"; filter: QueueFilterKey }
  | { kind: "cases"; tab: CasesTabKey };

export const listKey = (s: ListSpec): string =>
  s.kind === "reports" ? `reports:${s.status ?? "all"}` : s.kind === "queue" ? `queue:${s.filter}` : s.kind === "cases" ? `cases:${s.tab}` : "notifications";

export type ListState = {
  /** Ids in server order (reports: public report number; cases: case uuid; notifications: id). */
  ids: string[];
  loaded: boolean;
  loading: boolean;
  hasMore: boolean;
  error: DomainError | null;
};

type ListInternal = ListState & {
  spec: ListSpec;
  cursor: KeysetCursor | null;
  offset: number | null;
  position: { lat: number; lng: number } | null;
  /** Bumped when page 1 is reloaded: late results of older pages are dropped. */
  generation: number;
};

export type Summary = { kind: "citizen"; row: CitizenSummaryRow } | { kind: "officer"; row: OfficerSummaryRow };

export type SubmitOptions = {
  onProgress?: (p: SubmitProgress) => void;
  /** Paths already uploaded for this submission (e.g. by an attempt before an app restart). */
  uploaded?: readonly string[];
  /** Called after each successful upload, so the caller can persist progress. */
  onUploaded?: (path: string) => void;
  /** The server could not find uploaded files: forget the recorded progress. */
  onUploadsInvalid?: () => void;
};

export type CoreBackendStore = ReturnType<typeof createCoreBackendStore>;

type Deps = {
  userId: string;
  role: "citizen" | "officer";
  ops: CoreOperations;
  storage: EvidenceStorage;
  now?: () => Date;
  /** Skip a focus refresh if the last one is younger than this. */
  minFocusRefreshMs?: number;
  pageSize?: number;
  /** Called when the server says the session is no longer valid. */
  onUnauthenticated?: () => void;
};

const REQUIRED_SLOTS = ["FRONT", "SIDE", "REAR"] as const;
const RESIGN_COOLDOWN_MS = 60_000;

/** Monday 00:00 local time: "this week" for the citizen home statistics. */
export function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function createCoreBackendStore({ userId, role, ops, storage, now = () => new Date(), minFocusRefreshMs = 5000, pageSize = 25, onUnauthenticated }: Deps) {
  let cache: RowCache = emptyCache();
  let state: ParkWatchState | null = null;
  let summary: Summary | null = null;
  let status: CoreStatus = { phase: "idle", refreshing: false, error: null, lastLoadedAt: null };
  const lists = new Map<string, ListInternal>();
  const caseLoads = new Map<string, "loading" | "loaded">();
  const reportLoads = new Map<string, "loading" | "loaded">();
  let queuePosition: { lat: number; lng: number } | null = null;
  let inflight: Promise<Result<true>> | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();
  /** "bucket/path" -> signed url */
  const signed = new Map<string, { url: string; expiresAt: number }>();
  const lastForcedResign = new Map<string, number>();
  /** Stable list snapshots for React (replaced only when the list changes). */
  const listSnapshots = new Map<string, ListState>();

  /** Bumped on every change (one snapshot for React covering state, lists and summary). */
  let version = 0;
  const emit = () => {
    version += 1;
    listeners.forEach((l) => l());
  };
  const setStatus = (patch: Partial<CoreStatus>) => {
    status = { ...status, ...patch };
    emit();
  };

  const watch = <T>(r: Result<T>): Result<T> => {
    if (!r.ok && r.error.code === "UNAUTHENTICATED") onUnauthenticated?.();
    return r;
  };

  // ---------------------------------------------------------------------------
  // Signed URLs

  async function signMissing() {
    const t = now().getTime();
    const margin = 5 * 60 * 1000; // re-sign anything expiring within 5 minutes
    const paths = storagePathsOf(cacheToRows(cache));
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

  function rebuild() {
    state = snapshotToState(cacheToRows(cache), resolveUri);
  }

  /**
   * While a refresh runs, every bundle received is also collected: after a fully
   * successful refresh the cache is rebuilt from ONLY that data, so rows the
   * user can no longer see (revoked membership, other area) disappear instead
   * of lingering from an earlier page.
   */
  let collected: Partial<PageBundle>[] | null = null;

  async function absorb(bundle: Partial<PageBundle>) {
    cache = mergeBundle(cache, bundle);
    collected?.push(bundle);
    await signMissing();
  }

  // ---------------------------------------------------------------------------
  // Lists

  function listSnapshot(key: string): ListState {
    const l = lists.get(key);
    const base: ListState = l
      ? { ids: l.ids, loaded: l.loaded, loading: l.loading, hasMore: l.hasMore, error: l.error }
      : { ids: [], loaded: false, loading: false, hasMore: false, error: null };
    const prev = listSnapshots.get(key);
    if (prev && prev.ids === base.ids && prev.loaded === base.loaded && prev.loading === base.loading && prev.hasMore === base.hasMore && prev.error === base.error) return prev;
    listSnapshots.set(key, base);
    return base;
  }

  function fetchPage(l: ListInternal, first: boolean): Promise<Result<PageBundle>> {
    const s = l.spec;
    const cursor = first ? null : l.cursor;
    switch (s.kind) {
      case "reports":
        return ops.pageMyReports(s.status, cursor, pageSize);
      case "notifications":
        return ops.pageMyNotifications(cursor, pageSize);
      case "cases":
        return ops.pageMyCases(s.tab, cursor, pageSize);
      case "queue":
        return ops.pageOfficerQueue(s.filter, first ? queuePosition : l.position, first ? 0 : l.offset ?? 0, pageSize);
    }
  }

  async function loadPage(key: string, first: boolean): Promise<Result<true>> {
    const l = lists.get(key);
    if (!l) return ok(true as const);
    if (first) {
      l.generation += 1;
      l.position = queuePosition;
    }
    const gen = l.generation;
    l.loading = true;
    emit();
    const r = watch(await fetchPage(l, first));
    if (disposed || l.generation !== gen) return ok(true as const); // superseded by a newer page 1
    if (!r.ok) {
      l.loading = false;
      l.error = r.error;
      emit();
      return r;
    }
    await absorb(r.value);
    if (disposed || l.generation !== gen) return ok(true as const);
    // Report lists use the citizen-visible number (the domain report id).
    const pageIds =
      l.spec.kind === "reports" ? r.value.ids.map((id) => cache.reports.get(id)).filter((x) => !!x).map((x) => String(x!.public_report_number)) : r.value.ids;
    // Rows can shift between pages while data changes: never show one twice.
    l.ids = first ? [...new Set(pageIds)] : [...new Set([...l.ids, ...pageIds])];
    l.cursor = r.value.next_cursor ?? null;
    l.offset = r.value.next_offset ?? null;
    l.hasMore = l.spec.kind === "queue" ? r.value.next_offset != null : !!r.value.next_cursor;
    l.loaded = true;
    l.loading = false;
    l.error = null;
    rebuild();
    emit();
    return ok(true as const);
  }

  // ---------------------------------------------------------------------------
  // Refresh

  async function loadSummary(): Promise<Result<true>> {
    const t = now();
    if (role === "citizen") {
      const [s, ledger] = await Promise.all([ops.getCitizenSummary(startOfWeek(t).toISOString()), ops.getMyLedger()]);
      if (disposed) return fail("UNAUTHENTICATED", "UNAUTHENTICATED"); // signed out meanwhile: keep nothing
      watch(s);
      watch(ledger);
      if (!s.ok) return s;
      if (!ledger.ok) return ledger;
      summary = { kind: "citizen", row: s.value };
      cache = replaceLedger(cache, ledger.value);
      return ok(true as const);
    }
    const s = watch(await ops.getOfficerSummary(startOfDay(t).toISOString()));
    if (disposed) return fail("UNAUTHENTICATED", "UNAUTHENTICATED");
    if (!s.ok) return s;
    summary = { kind: "officer", row: s.value };
    return ok(true as const);
  }

  function refresh(): Promise<Result<true>> {
    if (inflight) return inflight;
    const first = summary === null;
    setStatus(first ? { phase: "loading", error: null } : { refreshing: true });
    collected = [];
    inflight = (async () => {
      // Page 1 of every list in use, in parallel with the summary; stale cursors are dropped.
      const [s, ...pages] = await Promise.all([loadSummary(), ...[...lists.keys()].map((k) => loadPage(k, true))]);
      if (disposed) return fail<true>("UNAUTHENTICATED", "UNAUTHENTICATED");
      // Details that screens have open are re-read too, so they never show stale state.
      const details = await Promise.all([...[...caseLoads.keys()].map((id) => loadCase(id)), ...[...reportLoads.keys()].map((n) => loadReport(n))]);
      if (disposed) return fail<true>("UNAUTHENTICATED", "UNAUTHENTICATED");
      if (s.ok) {
        const failed = [...pages, ...details].find((p) => !p.ok);
        if (!failed && collected) {
          const ledger = [...cache.ledger.values()];
          cache = replaceLedger(collected.reduce(mergeBundle, emptyCache()), ledger);
        }
        rebuild();
        status = { phase: "ready", refreshing: false, error: failed && !failed.ok ? failed.error : null, lastLoadedAt: now().getTime() };
        emit();
        return failed ?? ok(true as const);
      }
      setStatus({ phase: summary ? "ready" : "error", refreshing: false, error: s.error });
      return s;
    })().finally(() => {
      inflight = null;
      collected = null;
    });
    return inflight;
  }

  /** After a mutation: a refresh that started BEFORE the change must not count. */
  async function refreshAfterChange(): Promise<void> {
    if (inflight) await inflight;
    await refresh();
  }

  // ---------------------------------------------------------------------------
  // Details

  async function loadCase(caseId: string): Promise<Result<true>> {
    if (caseLoads.get(caseId) !== "loaded") caseLoads.set(caseId, "loading");
    const r = watch(await ops.getCaseDetail(caseId));
    if (disposed) return ok(true as const);
    if (!r.ok) {
      if (caseLoads.get(caseId) === "loading") caseLoads.delete(caseId);
      emit();
      return r;
    }
    const visible = (r.value.cases ?? []).some((c) => c.id === caseId);
    if (visible) await absorb(r.value);
    else cache = dropCase(cache, caseId); // no longer visible to this user: never show a stale copy
    caseLoads.set(caseId, "loaded");
    rebuild();
    emit();
    return ok(true as const);
  }

  async function loadReport(publicNumber: string): Promise<Result<true>> {
    if (reportLoads.get(publicNumber) !== "loaded") reportLoads.set(publicNumber, "loading");
    const r = watch(await ops.getMyReport(Number(publicNumber)));
    if (disposed) return ok(true as const);
    if (!r.ok) {
      if (reportLoads.get(publicNumber) === "loading") reportLoads.delete(publicNumber);
      emit();
      return r;
    }
    await absorb(r.value);
    reportLoads.set(publicNumber, "loaded");
    rebuild();
    emit();
    return ok(true as const);
  }

  // ---------------------------------------------------------------------------
  // Citizen: submit (upload photos -> server function -> refresh)

  function submissionItems(draft: ReportDraft): { ev: CitizenEvidence; slot: SubmitEvidenceInput["slot"]; path: string }[] {
    const photos = REQUIRED_SLOTS.map((slot) => draft.photos[slot]).filter((p): p is CitizenEvidence => !!p);
    return [
      ...photos.map((p) => ({ ev: p, slot: p.type as SubmitEvidenceInput["slot"] })),
      ...draft.attachments.map((a) => ({ ev: a, slot: "ATTACHMENT" as const })),
    ].map(({ ev, slot }) => ({ ev, slot, path: reportEvidencePath(userId, draft.draftId, ev.id, imageTypeOf(ev.uri).ext) }));
  }

  async function submitReport(draft: ReportDraft, opts: SubmitOptions = {}): Promise<Result<{ reportId: string; created: boolean }>> {
    const photos = REQUIRED_SLOTS.map((slot) => draft.photos[slot]).filter((p): p is CitizenEvidence => !!p);
    if (photos.length !== 3 || !draft.violationId || !draft.location.address.trim()) return fail("INVALID_DRAFT", "INVALID_DRAFT");
    const items = submissionItems(draft);
    const uploaded = new Set(opts.uploaded ?? []);

    opts.onProgress?.("uploading");
    for (const it of items) {
      if (uploaded.has(it.path)) continue; // uploaded by an earlier attempt of THIS submission
      const u = watch(await storage.upload(EVIDENCE_BUCKETS.citizen, it.path, it.ev.uri));
      // Nothing is deleted on failure: finished uploads stay for the retry.
      if (!u.ok) return u;
      uploaded.add(it.path);
      opts.onUploaded?.(it.path);
    }

    opts.onProgress?.("submitting");
    const vehicle = draft.vehicle ?? MVP_MOCK_DETECTED_VEHICLE;
    const coords = draft.location.coordinates;
    // The submission id is the draft id: the same on every retry, also after a restart.
    // If an earlier attempt committed but its response was lost, this returns that report.
    const r = watch(
      await ops.submitReport({
        submissionId: draft.draftId,
        violationType: draft.violationId,
        locationAddress: draft.location.address.trim(),
        observedAt: draft.observedAt ?? photos[0].capturedAt,
        submittedAt: now().toISOString(),
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
      })
    );
    if (!r.ok) {
      if (r.error.code === "EVIDENCE_NOT_UPLOADED") opts.onUploadsInvalid?.();
      return r;
    }
    // Uploads of this submission that did not end up in the report (e.g. a removed
    // attachment) are orphans. Only paths outside the submitted list are offered, and
    // the server refuses to delete attached evidence, so report photos are safe.
    const used = new Set(items.map((i) => i.path));
    const orphans = [...uploaded].filter((p) => !used.has(p) && p.startsWith(`${userId}/`));
    if (orphans.length) await storage.remove(EVIDENCE_BUCKETS.citizen, orphans);
    const reportId = String(r.value.publicReportNumber);
    await refreshAfterChange();
    await loadReport(reportId);
    return ok({ reportId, created: r.value.created });
  }

  /** Discarded unsent draft: remove its uploads (the server keeps anything already attached to a report). */
  async function abandonSubmission(paths: readonly string[]): Promise<void> {
    const own = paths.filter((p) => p.startsWith(`${userId}/`));
    if (own.length) await storage.remove(EVIDENCE_BUCKETS.citizen, own);
  }

  // ---------------------------------------------------------------------------
  // Officer mutations with ambiguous-result reconciliation

  const caseRow = (id: string) => cache.cases.get(id);
  const mine = (id: string) => caseRow(id)?.assigned_officer_id === userId;
  const inspectionOf = (caseId: string) => cache.inspections.get(caseId);
  const checkOf = (caseId: string, key: ChecklistKey) => {
    const i = inspectionOf(caseId);
    return i ? cache.inspection_checks.get(`${i.id}:${key}`) : undefined;
  };

  /**
   * Run a case mutation. On a network failure the outcome is unknown, so the
   * case is re-read: if the change is already on the server it is a success;
   * if it is not, the failure stands (retrying is safe: the functions are
   * idempotent). If the case cannot be re-read either: RESULT_UNKNOWN.
   */
  async function mutateCase<T>(caseId: string, run: () => Promise<Result<T>>, applied: () => Result<T> | null): Promise<Result<T>> {
    const r = watch(await run());
    if (r.ok) {
      await Promise.all([refreshAfterChange(), loadCase(caseId)]);
      return r;
    }
    if (r.error.code !== "NETWORK_ERROR") {
      // Rule refusals (taken, completed, wrong stage): show the server's current state.
      if (r.error.code !== "UNAUTHENTICATED") void loadCase(caseId);
      return r;
    }
    const check = await loadCase(caseId);
    if (!check.ok) return fail("RESULT_UNKNOWN", "RESULT_UNKNOWN");
    const verdict = applied();
    if (verdict) {
      if (verdict.ok) await refreshAfterChange();
      return verdict;
    }
    return r;
  }

  async function setOfficerPhoto(caseId: string, type: OfficerEvidenceType, uri: string, capturedAt?: string): Promise<Result<{ evidenceId: string }>> {
    const previous = [...cache.officer_evidence.values()].find((e) => e.case_id === caseId && e.evidence_type === type)?.storage_path;
    const captureId = `${type}-${now().getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const path = officerEvidencePath(caseId, captureId, imageTypeOf(uri).ext);
    const u = watch(await storage.upload(EVIDENCE_BUCKETS.officer, path, uri));
    if (!u.ok) return u;
    const r = await mutateCase(
      caseId,
      () => ops.addOfficerEvidence(caseId, type, path, capturedAt ?? now().toISOString()),
      () => {
        const e = [...cache.officer_evidence.values()].find((x) => x.case_id === caseId && x.evidence_type === type);
        return e?.storage_path === path ? ok({ evidenceId: e.id }) : null;
      }
    );
    if (!r.ok) {
      // Not attached (refused, or confirmed not applied): the new object is an orphan.
      if (r.error.code !== "RESULT_UNKNOWN") await storage.remove(EVIDENCE_BUCKETS.officer, [path]);
      return r;
    }
    // The retaken photo replaced the old one; the old object is now unattached.
    if (previous && previous !== path) await storage.remove(EVIDENCE_BUCKETS.officer, [previous]);
    return r;
  }

  const voidResult = async (p: Promise<Result<unknown>>): Promise<Result<void>> => {
    const r = await p;
    return r.ok ? ok(undefined) : r;
  };
  const changed = ok({ changed: true });

  return {
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getState: () => state,
    getVersion: () => version,
    getStatus: () => status,
    getSummary: () => summary,
    getList: (spec: ListSpec) => listSnapshot(listKey(spec)),
    /** Load-state of a case detail: undefined (never asked), "loading", "loaded". */
    getCaseLoad: (caseId: string) => caseLoads.get(caseId),
    getReportLoad: (publicNumber: string) => reportLoads.get(publicNumber),
    refresh,
    /** Focus/foreground refresh: skipped if data is very fresh. */
    refreshIfStale() {
      if (status.lastLoadedAt !== null && now().getTime() - status.lastLoadedAt < minFocusRefreshMs) return Promise.resolve(ok(true as const));
      return refresh();
    },
    /** A list screen is shown: load its first page once (refresh keeps it current). */
    ensureList(spec: ListSpec) {
      const key = listKey(spec);
      if (!lists.has(key)) {
        lists.set(key, { spec, ids: [], loaded: false, loading: false, hasMore: false, error: null, cursor: null, offset: null, position: null, generation: 0 });
      }
      const l = lists.get(key)!;
      if (!l.loaded && !l.loading) void loadPage(key, true);
    },
    loadMore(spec: ListSpec) {
      const key = listKey(spec);
      const l = lists.get(key);
      if (!l || l.loading) return;
      // Also the Retry of a failed first page.
      if (!l.loaded) void loadPage(key, true);
      else if (l.hasMore) void loadPage(key, false);
    },
    /** Officer position for "nearest first"; used from the next page-1 load. */
    setQueuePosition(pos: { lat: number; lng: number } | null) {
      queuePosition = pos;
    },
    /** A detail screen is shown: (re)load that case so it is current even if no list page holds it. */
    ensureCase(caseId: string) {
      if (caseLoads.get(caseId) !== "loading") void loadCase(caseId);
    },
    ensureReport(publicNumber: string) {
      if (/^\d+$/.test(publicNumber) && reportLoads.get(publicNumber) !== "loading") void loadReport(publicNumber);
    },
    /**
     * A displayed signed URL failed (most likely expired): sign that object
     * again, at most once a minute per object, so a broken file cannot loop.
     */
    async refreshSignedUrl(url: string): Promise<boolean> {
      const key = [...signed.entries()].find(([, v]) => v.url === url)?.[0];
      if (!key) return false;
      const t = now().getTime();
      if (t - (lastForcedResign.get(key) ?? -Infinity) < RESIGN_COOLDOWN_MS) return false;
      lastForcedResign.set(key, t);
      const slash = key.indexOf("/");
      const bucket = key.slice(0, slash) as EvidenceBucket;
      const path = key.slice(slash + 1);
      const urls = await storage.sign(bucket, [path]);
      if (disposed || !urls[path]) return false;
      signed.set(key, { url: urls[path], expiresAt: t + SIGNED_URL_TTL_SECONDS * 1000 });
      rebuild();
      emit();
      return true;
    },
    /** Sign-out / account switch: drop everything so nothing leaks to the next account. */
    dispose() {
      disposed = true;
      state = null;
      cache = emptyCache();
      summary = null;
      lists.clear();
      signed.clear();
      listeners.clear();
    },

    submitReport,
    abandonSubmission,
    /** Storage paths a draft's photos are (or will be) uploaded to. */
    submissionPaths: (draft: ReportDraft) => submissionItems(draft).map((i) => i.path),
    acceptCase: (caseId: string) =>
      voidResult(mutateCase(caseId, () => ops.acceptCase(caseId), () => (mine(caseId) && caseRow(caseId)?.status !== "NEW" ? changed : null))),
    startEnRoute: (caseId: string) =>
      voidResult(
        mutateCase(caseId, () => ops.startEnRoute(caseId), () =>
          mine(caseId) && ["EN_ROUTE", "ON_SITE", "INSPECTION", "COMPLETED"].includes(caseRow(caseId)?.status ?? "") ? changed : null
        )
      ),
    startInspection: (caseId: string) =>
      voidResult(mutateCase(caseId, () => ops.startInspection(caseId), () => (mine(caseId) && inspectionOf(caseId) ? changed : null))),
    setChecklistItem: (caseId: string, key: ChecklistKey, value: boolean | null) =>
      voidResult(mutateCase(caseId, () => ops.setInspectionCheck(caseId, key, value), () => (checkOf(caseId, key)?.answer === value ? changed : null))),
    confirmPlateBySimulatedScan: (caseId: string) =>
      voidResult(mutateCase(caseId, () => ops.confirmPlateByScan(caseId), () => (inspectionOf(caseId)?.plate_confirmed_via_scan_at ? changed : null))),
    setOfficerPhoto,
    async completeCase(caseId: string, code: EnforcementOutcomeCode, notes?: string): Promise<Result<{ changed: boolean }>> {
      const r = await mutateCase(caseId, () => ops.completeCase(caseId, code, notes), () => {
        const o = cache.outcomes.get(caseId);
        if (!o) return null;
        return o.code === code ? ok({ changed: true, creditedCents: 0 }) : fail("ALREADY_COMPLETED", "ALREADY_COMPLETED");
      });
      return r.ok ? ok({ changed: r.value.changed }) : r;
    },
    async markNotificationsRead(): Promise<Result<void>> {
      const unread = (summary?.row.unread_notifications ?? 0) > 0 || [...cache.notifications.values()].some((n) => n.recipient_id === userId && !n.read_at);
      if (!unread) return ok(undefined);
      const r = watch(await ops.markMyNotificationsRead());
      if (!r.ok) return r;
      await refreshAfterChange();
      return ok(undefined);
    },
  };
}
