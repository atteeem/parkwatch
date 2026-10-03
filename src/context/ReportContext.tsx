import React, { createContext, useContext, useState, useCallback } from "react";

// In-progress CITIZEN report draft only. Officer inspection state lives in
// the store, keyed by case, and never touches this context.

export type CitizenPhotoSlot = "front" | "side" | "rear";

export type ReportDraft = {
  /** Stable id for this draft; submitting the same draft twice is a no-op. */
  draftId: string;
  photos: Partial<Record<CitizenPhotoSlot, string>>;
  /** ISO capture time per photo slot. */
  photoCapturedAt: Partial<Record<CitizenPhotoSlot, string>>;
  violation?: string;
  location?: string;
  date?: string;
  time?: string;
  notes?: string;
  attachments: string[];
};

const newDraftId = () => `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const emptyDraft = (): ReportDraft => ({
  draftId: newDraftId(),
  photos: {},
  photoCapturedAt: {},
  attachments: [],
});

type ReportContextValue = {
  draft: ReportDraft;
  setPhoto: (slot: CitizenPhotoSlot, uri: string) => void;
  setViolation: (violation: string) => void;
  setLocation: (location: string) => void;
  setDateTime: (date: string, time: string) => void;
  setNotes: (notes: string) => void;
  addAttachment: (uri: string) => void;
  resetDraft: () => void;
};

const ReportContext = createContext<ReportContextValue | null>(null);

export function ReportProvider({ children }: { children: React.ReactNode }) {
  const [draft, setDraft] = useState<ReportDraft>(emptyDraft);

  const setPhoto = useCallback((slot: CitizenPhotoSlot, uri: string) => {
    const capturedAt = new Date().toISOString();
    setDraft((d) => ({
      ...d,
      photos: { ...d.photos, [slot]: uri },
      photoCapturedAt: { ...d.photoCapturedAt, [slot]: capturedAt },
    }));
  }, []);
  const setViolation = useCallback((violation: string) => {
    setDraft((d) => ({ ...d, violation }));
  }, []);
  const setLocation = useCallback((location: string) => {
    setDraft((d) => ({ ...d, location }));
  }, []);
  const setDateTime = useCallback((date: string, time: string) => {
    setDraft((d) => ({ ...d, date, time }));
  }, []);
  const setNotes = useCallback((notes: string) => {
    setDraft((d) => ({ ...d, notes }));
  }, []);
  const addAttachment = useCallback((uri: string) => {
    setDraft((d) => ({ ...d, attachments: [...d.attachments, uri] }));
  }, []);
  const resetDraft = useCallback(() => setDraft(emptyDraft()), []);

  return (
    <ReportContext.Provider
      value={{ draft, setPhoto, setViolation, setLocation, setDateTime, setNotes, addAttachment, resetDraft }}
    >
      {children}
    </ReportContext.Provider>
  );
}

export function useReportDraft(): ReportContextValue {
  const ctx = useContext(ReportContext);
  if (!ctx) throw new Error("useReportDraft must be used within ReportProvider");
  return ctx;
}
