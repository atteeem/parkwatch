import React, { createContext, useCallback, useContext, useMemo, useReducer } from "react";
import { CitizenEvidenceType, GeoPoint, ReportDraft } from "../domain";
import { draftReducer, newDraftId, newDraftState } from "../presentation/reportDraft";

// In-progress CITIZEN report draft only. Officer inspection state lives in
// the store, keyed by case, and never touches this context.

type ReportContextValue = {
  draft: ReportDraft;
  /** Set once this draft has been submitted (it is then finished). */
  submittedReportId?: string;
  /** Intentional "new report" entry points only (Home CTA, Report tab, My Reports +). */
  startNewReport: () => void;
  capturePhoto: (slot: CitizenEvidenceType, uri: string, capturedAt: string) => void;
  setViolation: (violationId: string) => void;
  setLocation: (address: string) => void;
  /** Store the device GPS fix (machine location) separately from the typed address. */
  setCoordinates: (coordinates: GeoPoint) => void;
  setNotes: (notes: string) => void;
  addAttachment: (uri: string) => void;
  removeAttachment: (evidenceId: string) => void;
  markSubmitted: (reportId: string) => void;
};

const ReportContext = createContext<ReportContextValue | null>(null);

export function ReportProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(draftReducer, undefined, () => newDraftState(newDraftId()));

  const startNewReport = useCallback(() => dispatch({ type: "START_NEW", draftId: newDraftId() }), []);
  const capturePhoto = useCallback(
    (slot: CitizenEvidenceType, uri: string, capturedAt: string) => dispatch({ type: "CAPTURE_PHOTO", slot, uri, capturedAt }),
    []
  );
  const setViolation = useCallback((violationId: string) => dispatch({ type: "SET_VIOLATION", violationId }), []);
  const setLocation = useCallback((address: string) => dispatch({ type: "SET_LOCATION", address }), []);
  const setCoordinates = useCallback((coordinates: GeoPoint) => dispatch({ type: "SET_COORDINATES", coordinates }), []);
  const setNotes = useCallback((notes: string) => dispatch({ type: "SET_NOTES", notes }), []);
  const addAttachment = useCallback(
    (uri: string) => dispatch({ type: "ADD_ATTACHMENT", uri, pickedAt: new Date().toISOString() }),
    []
  );
  const removeAttachment = useCallback((evidenceId: string) => dispatch({ type: "REMOVE_ATTACHMENT", evidenceId }), []);
  const markSubmitted = useCallback((reportId: string) => dispatch({ type: "MARK_SUBMITTED", reportId }), []);

  const value = useMemo(
    () => ({
      draft: state.draft,
      submittedReportId: state.submittedReportId,
      startNewReport,
      capturePhoto,
      setViolation,
      setLocation,
      setCoordinates,
      setNotes,
      addAttachment,
      removeAttachment,
      markSubmitted,
    }),
    [state, startNewReport, capturePhoto, setViolation, setLocation, setCoordinates, setNotes, addAttachment, removeAttachment, markSubmitted]
  );

  return <ReportContext.Provider value={value}>{children}</ReportContext.Provider>;
}

export function useReportDraft(): ReportContextValue {
  const ctx = useContext(ReportContext);
  if (!ctx) throw new Error("useReportDraft must be used within ReportProvider");
  return ctx;
}
