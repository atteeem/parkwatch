import React, { createContext, useContext, useMemo, useState, useCallback } from "react";
import { UserReport, OfficerCase, CaseStatus } from "../data/types";
import { INITIAL_USER_REPORTS } from "../data/mockReports";
import { INITIAL_OFFICER_CASES } from "../data/mockCases";
import {
  INITIAL_USER_NOTIFICATIONS,
  INITIAL_OFFICER_NOTIFICATIONS,
  Notification,
} from "../data/mockNotifications";

let idCounter = 12600;
const nextReportId = () => String(idCounter++);

export type OfficerInspectionDraft = {
  caseId: string | null;
  vehiclePresent: boolean | null;
  plateMatched: boolean | null;
  violationConfirmed: boolean | null;
  restrictionVerified: boolean | null;
  officerPhotos: {
    overview?: string;
    plate?: string;
    sign?: string;
    context?: string;
  };
  result?: string; // 'charge' | one of CLOSE_WITHOUT_CHARGE_REASONS ids
  notes: string;
};

const EMPTY_INSPECTION: OfficerInspectionDraft = {
  caseId: null,
  vehiclePresent: null,
  plateMatched: null,
  violationConfirmed: null,
  restrictionVerified: null,
  officerPhotos: {},
  result: undefined,
  notes: "",
};

type AppContextValue = {
  // citizen-side
  userReports: UserReport[];
  submitUserReport: (draft: {
    images: string[];
    violation: string;
    location: string;
    date: string;
    time: string;
    notes: string;
  }) => UserReport;
  walletAvailable: number;
  walletPending: number;
  walletPaidOut: number;
  withdraw: (amount: number) => void;

  // officer-side
  officerCases: OfficerCase[];
  getCase: (id: string) => OfficerCase | undefined;
  acceptCase: (id: string) => void;
  setCaseStatus: (id: string, status: CaseStatus) => void;
  completeInspection: (
    id: string,
    result: { outcome: "charge" | "closed"; reasonId?: string; chargeAmount?: number; notes?: string }
  ) => void;

  officerDraft: OfficerInspectionDraft;
  startInspectionDraft: (caseId: string) => void;
  updateOfficerDraft: (patch: Partial<OfficerInspectionDraft>) => void;
  setOfficerPhoto: (key: keyof OfficerInspectionDraft["officerPhotos"], uri: string) => void;
  resetOfficerDraft: () => void;

  // notifications
  userNotifications: Notification[];
  officerNotifications: Notification[];
  markUserNotificationsRead: () => void;
  markOfficerNotificationsRead: () => void;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [userReports, setUserReports] = useState<UserReport[]>(INITIAL_USER_REPORTS);
  const [officerCases, setOfficerCases] = useState<OfficerCase[]>(INITIAL_OFFICER_CASES);
  const [userNotifications, setUserNotifications] = useState<Notification[]>(INITIAL_USER_NOTIFICATIONS);
  const [officerNotifications, setOfficerNotifications] = useState<Notification[]>(INITIAL_OFFICER_NOTIFICATIONS);
  const [walletPaidOut, setWalletPaidOut] = useState(55);
  const [officerDraft, setOfficerDraft] = useState<OfficerInspectionDraft>(EMPTY_INSPECTION);

  const walletAvailable = useMemo(
    () =>
      userReports
        .filter((r) => r.status === "verified" && r.rewardState === "rewarded")
        .reduce((sum, r) => sum + (r.reward ?? 0), 0) + 40,
    [userReports]
  );
  const walletPending = useMemo(
    () =>
      userReports
        .filter((r) => r.status === "under-review")
        .reduce((sum, r) => sum + (r.reward ?? 5), 0) + 15,
    [userReports]
  );

  const submitUserReport: AppContextValue["submitUserReport"] = useCallback((draft) => {
    const id = nextReportId();
    const report: UserReport = {
      id,
      plate: "NEW-" + id.slice(-3),
      violation: draft.violation,
      violationNote: draft.notes || undefined,
      location: draft.location || "Current location, Helsinki",
      status: "under-review",
      reward: 5,
      rewardState: "estimated",
      submittedAt: new Date().toISOString(),
      images: draft.images,
      notes: draft.notes,
    };
    setUserReports((list) => [report, ...list]);

    // Mirror it into the officer queue so the enforcement side of the
    // demo has something new to react to as well.
    setOfficerCases((list) => [
      {
        id: "c-" + id,
        reportId: id,
        plate: report.plate,
        violation: draft.notes || report.violation,
        location: report.location,
        distance: 0.4,
        priority: "normal",
        status: "new",
        reporterReliability: "High",
        reporterName: "You",
        reporterAcceptanceRate: 92,
        reporterVerifiedReports: 79,
        images: draft.images,
        reportedAgo: "just now",
        notes: draft.notes,
      },
      ...list,
    ]);
    setUserNotifications((list) => [
      {
        id: "un-" + id,
        group: "Today",
        title: "Report under review",
        body: `Your report #${id} is now under review by a parking officer.`,
        time: "just now",
        kind: "pending",
        unread: true,
      },
      ...list,
    ]);
    return report;
  }, []);

  const withdraw = useCallback((amount: number) => {
    setWalletPaidOut((v) => v + amount);
  }, []);

  const getCase = useCallback((id: string) => officerCases.find((c) => c.id === id), [officerCases]);

  const acceptCase = useCallback((id: string) => {
    setOfficerCases((list) => list.map((c) => (c.id === id ? { ...c, status: "assigned" } : c)));
  }, []);

  const setCaseStatus = useCallback((id: string, status: CaseStatus) => {
    setOfficerCases((list) => list.map((c) => (c.id === id ? { ...c, status } : c)));
  }, []);

  const completeInspection: AppContextValue["completeInspection"] = useCallback(
    (id, result) => {
      setOfficerCases((list) =>
        list.map((c) =>
          c.id === id
            ? { ...c, status: "completed", chargeAmount: result.outcome === "charge" ? result.chargeAmount ?? 60 : undefined }
            : c
        )
      );
      const theCase = officerCases.find((c) => c.id === id);
      if (theCase) {
        setUserReports((list) =>
          list.map((r) =>
            r.id === theCase.reportId
              ? {
                  ...r,
                  status: result.outcome === "charge" ? "verified" : "rejected",
                  rewardState: result.outcome === "charge" ? "rewarded" : "none",
                }
              : r
          )
        );
      }
    },
    [officerCases]
  );

  const startInspectionDraft = useCallback((caseId: string) => {
    setOfficerDraft({ ...EMPTY_INSPECTION, caseId, officerPhotos: {} });
  }, []);
  const updateOfficerDraft = useCallback((patch: Partial<OfficerInspectionDraft>) => {
    setOfficerDraft((d) => ({ ...d, ...patch }));
  }, []);
  const setOfficerPhoto = useCallback((key: keyof OfficerInspectionDraft["officerPhotos"], uri: string) => {
    setOfficerDraft((d) => ({ ...d, officerPhotos: { ...d.officerPhotos, [key]: uri } }));
  }, []);
  const resetOfficerDraft = useCallback(() => setOfficerDraft(EMPTY_INSPECTION), []);

  const markUserNotificationsRead = useCallback(() => {
    setUserNotifications((list) => list.map((n) => ({ ...n, unread: false })));
  }, []);
  const markOfficerNotificationsRead = useCallback(() => {
    setOfficerNotifications((list) => list.map((n) => ({ ...n, unread: false })));
  }, []);

  const value: AppContextValue = {
    userReports,
    submitUserReport,
    walletAvailable,
    walletPending,
    walletPaidOut,
    withdraw,
    officerCases,
    getCase,
    acceptCase,
    setCaseStatus,
    completeInspection,
    officerDraft,
    startInspectionDraft,
    updateOfficerDraft,
    setOfficerPhoto,
    resetOfficerDraft,
    userNotifications,
    officerNotifications,
    markUserNotificationsRead,
    markOfficerNotificationsRead,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
