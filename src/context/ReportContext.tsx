import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { CitizenEvidenceType, GeoPoint, ReportDraft } from "../domain";
import { draftReducer, newDraftId, newDraftState } from "../presentation/reportDraft";
import {
  clearPersistedDraft,
  hasDraftContent,
  loadPersistedDraft,
  PersistedDraft,
  resumeRoute,
  savePersistedDraft,
  WizardRoute,
} from "../presentation/draftPersistence";
import { asyncStorageAdapter } from "../store/asyncStorageAdapter";
import type { KeyValueStorage } from "../store/persistence";
import { useAuth } from "../auth/AuthContext";
import { useApp } from "./AppContext";

// In-progress CITIZEN report draft only. Officer inspection state lives in
// the store, keyed by case, and never touches this context.
//
// Server-backed mode (T8.4): the unsent draft is persisted on the phone per
// signed-in user (draft id, inputs, local photo URIs, finished uploads) until
// the server accepts it or the user discards it, so closing the app, a crash
// or an expired session never loses it. Local demo: unchanged (memory only).

type ReportContextValue = {
  draft: ReportDraft;
  /** Set once this draft has been submitted (it is then finished). */
  submittedReportId?: string;
  /** Intentional "new report" entry points only (Home CTA, Report tab, My Reports +). In server mode an unsent draft is continued instead. */
  startNewReport: () => void;
  capturePhoto: (slot: CitizenEvidenceType, uri: string, capturedAt: string) => void;
  setViolation: (violationId: string) => void;
  /** Address typed by the citizen (fallback when GPS or geocoding is unavailable). */
  setLocation: (address: string) => void;
  /** A real device GPS fix (kept as provenance; the report point unless one was picked on the map). */
  setDeviceFix: (fix: GeoPoint) => void;
  /** The citizen corrected the report point on the map. */
  selectMapPoint: (point: { latitude: number; longitude: number }) => void;
  /** Use the device GPS fix as the report point again. */
  resetToDeviceFix: () => void;
  /** Reverse-geocoded address for a point (ignored if stale or the address was typed). */
  setGeocodedAddress: (address: string, point: { latitude: number; longitude: number }) => void;
  setNotes: (notes: string) => void;
  addAttachment: (uri: string) => void;
  removeAttachment: (evidenceId: string) => void;
  markSubmitted: (reportId: string) => void;

  /** Server mode: an unfinished, unsent report exists (restored after a restart or left mid-way). */
  unsentDraft: { savedAt?: string; route: WizardRoute } | null;
  /** Make the unsent draft the active one; returns the wizard step to open. */
  resumeDraft: () => WizardRoute;
  /** Throw the unsent draft away (after the user confirmed) and clean up its uploads. */
  discardDraft: () => Promise<void>;
  /** Uploads of the current submission that already finished (skipped on retry). */
  uploadedPaths: readonly string[];
  recordUpload: (path: string) => void;
  resetUploads: () => void;
};

const ReportContext = createContext<ReportContextValue | null>(null);

export function ReportProvider({ children, storage = asyncStorageAdapter }: { children: React.ReactNode; storage?: KeyValueStorage }) {
  const { state: auth } = useAuth();
  const { dataSource, abandonSubmission } = useApp();
  const userId = auth.mode === "BACKEND" && auth.status === "authenticated" ? auth.user.id : null;
  const persist = dataSource === "BACKEND" && !!userId;

  const [state, dispatch] = useReducer(draftReducer, undefined, () => newDraftState(newDraftId()));
  const [uploaded, setUploaded] = useState<string[]>([]);
  /** A persisted draft found at sign-in/start that the user has not continued or discarded yet. */
  const [recoverable, setRecoverable] = useState<PersistedDraft | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const userRef = useRef(userId);
  userRef.current = userId;

  // Account change (sign-in, sign-out, switch): never carry one person's draft over to another.
  useEffect(() => {
    dispatch({ type: "START_NEW", draftId: newDraftId() });
    setUploaded([]);
    setRecoverable(null);
    setLoadedFor(null);
    if (!persist || !userId) return;
    let live = true;
    void loadPersistedDraft(storage, userId).then((rec) => {
      if (!live || userRef.current !== userId) return;
      setRecoverable(rec && hasDraftContent(rec.draft) ? rec : null);
      setLoadedFor(userId);
    });
    return () => {
      live = false;
    };
  }, [persist, userId, storage]);

  // Save every change of an unsent draft (only after the stored one was read, and
  // never over a recoverable draft the user has not decided about yet).
  useEffect(() => {
    if (!persist || !userId || loadedFor !== userId || recoverable) return;
    if (state.submittedReportId !== undefined || !hasDraftContent(state.draft)) return;
    void savePersistedDraft(storage, { userId, draft: state.draft, uploaded }).catch(() => undefined);
  }, [persist, userId, loadedFor, recoverable, state, uploaded, storage]);

  const restore = useCallback((rec: PersistedDraft) => {
    dispatch({ type: "RESTORE", draft: rec.draft });
    setUploaded(rec.uploaded);
    setRecoverable(null);
  }, []);

  const currentUnsent = persist && state.submittedReportId === undefined && hasDraftContent(state.draft);

  const startNewReport = useCallback(() => {
    if (persist && recoverable) return restore(recoverable);
    if (currentUnsent) return; // continue the unfinished report instead of silently replacing it
    dispatch({ type: "START_NEW", draftId: newDraftId() });
    setUploaded([]);
  }, [persist, recoverable, restore, currentUnsent]);

  const resumeDraft = useCallback((): WizardRoute => {
    if (recoverable) {
      restore(recoverable);
      return resumeRoute(recoverable.draft);
    }
    return resumeRoute(state.draft);
  }, [recoverable, restore, state.draft]);

  const discardDraft = useCallback(async () => {
    const paths = recoverable ? recoverable.uploaded : uploaded;
    setRecoverable(null);
    dispatch({ type: "START_NEW", draftId: newDraftId() });
    setUploaded([]);
    if (userId) await clearPersistedDraft(storage, userId).catch(() => undefined);
    // Only this unsent submission's own uploads; the server keeps anything attached to a report.
    if (paths.length) await abandonSubmission(paths);
  }, [recoverable, uploaded, userId, storage, abandonSubmission]);

  const capturePhoto = useCallback(
    (slot: CitizenEvidenceType, uri: string, capturedAt: string) => dispatch({ type: "CAPTURE_PHOTO", slot, uri, capturedAt }),
    []
  );
  const setViolation = useCallback((violationId: string) => dispatch({ type: "SET_VIOLATION", violationId }), []);
  const setLocation = useCallback((address: string) => dispatch({ type: "SET_LOCATION", address }), []);
  const setDeviceFix = useCallback((fix: GeoPoint) => dispatch({ type: "SET_DEVICE_FIX", fix }), []);
  const selectMapPoint = useCallback((p: { latitude: number; longitude: number }) => dispatch({ type: "SELECT_MAP_POINT", latitude: p.latitude, longitude: p.longitude }), []);
  const resetToDeviceFix = useCallback(() => dispatch({ type: "USE_DEVICE_FIX" }), []);
  const setGeocodedAddress = useCallback(
    (address: string, point: { latitude: number; longitude: number }) => dispatch({ type: "SET_GEOCODED_ADDRESS", address, point }),
    []
  );
  const setNotes = useCallback((notes: string) => dispatch({ type: "SET_NOTES", notes }), []);
  const addAttachment = useCallback(
    (uri: string) => dispatch({ type: "ADD_ATTACHMENT", uri, pickedAt: new Date().toISOString() }),
    []
  );
  const removeAttachment = useCallback((evidenceId: string) => dispatch({ type: "REMOVE_ATTACHMENT", evidenceId }), []);
  const markSubmitted = useCallback(
    (reportId: string) => {
      dispatch({ type: "MARK_SUBMITTED", reportId });
      setUploaded([]);
      // Accepted by the server: the unsent copy is no longer needed.
      if (persist && userId) void clearPersistedDraft(storage, userId).catch(() => undefined);
    },
    [persist, userId, storage]
  );
  const recordUpload = useCallback((path: string) => setUploaded((u) => (u.includes(path) ? u : [...u, path])), []);
  const resetUploads = useCallback(() => setUploaded([]), []);

  const unsentDraft = useMemo<ReportContextValue["unsentDraft"]>(() => {
    if (!persist) return null;
    if (recoverable) return { savedAt: recoverable.savedAt, route: resumeRoute(recoverable.draft) };
    if (currentUnsent) return { route: resumeRoute(state.draft) };
    return null;
  }, [persist, recoverable, currentUnsent, state.draft]);

  const value = useMemo(
    () => ({
      draft: state.draft,
      submittedReportId: state.submittedReportId,
      startNewReport,
      capturePhoto,
      setViolation,
      setLocation,
      setDeviceFix,
      selectMapPoint,
      resetToDeviceFix,
      setGeocodedAddress,
      setNotes,
      addAttachment,
      removeAttachment,
      markSubmitted,
      unsentDraft,
      resumeDraft,
      discardDraft,
      uploadedPaths: uploaded,
      recordUpload,
      resetUploads,
    }),
    [state, startNewReport, capturePhoto, setViolation, setLocation, setDeviceFix, selectMapPoint, resetToDeviceFix, setGeocodedAddress, setNotes, addAttachment, removeAttachment, markSubmitted, unsentDraft, resumeDraft, discardDraft, uploaded, recordUpload, resetUploads]
  );

  return <ReportContext.Provider value={value}>{children}</ReportContext.Provider>;
}

export function useReportDraft(): ReportContextValue {
  const ctx = useContext(ReportContext);
  if (!ctx) throw new Error("useReportDraft must be used within ReportProvider");
  return ctx;
}
