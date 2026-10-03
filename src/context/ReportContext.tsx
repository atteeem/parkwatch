import React, { createContext, useContext, useState, useCallback } from "react";

export type ReportDraft = {
  photos: {
    front?: string;
    side?: string;
    rear?: string;
  };
  violation?: string;
  location?: string;
  date?: string;
  time?: string;
  notes?: string;
  attachments: string[];
};

const EMPTY_DRAFT: ReportDraft = {
  photos: {},
  attachments: [],
};

type ReportContextValue = {
  draft: ReportDraft;
  setPhoto: (slot: keyof ReportDraft["photos"], uri: string) => void;
  setViolation: (violation: string) => void;
  setLocation: (location: string) => void;
  setDateTime: (date: string, time: string) => void;
  setNotes: (notes: string) => void;
  addAttachment: (uri: string) => void;
  resetDraft: () => void;
};

const ReportContext = createContext<ReportContextValue | null>(null);

export function ReportProvider({ children }: { children: React.ReactNode }) {
  const [draft, setDraft] = useState<ReportDraft>(EMPTY_DRAFT);

  const setPhoto = useCallback((slot: keyof ReportDraft["photos"], uri: string) => {
    setDraft((d) => ({ ...d, photos: { ...d.photos, [slot]: uri } }));
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
  const resetDraft = useCallback(() => setDraft(EMPTY_DRAFT), []);

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
