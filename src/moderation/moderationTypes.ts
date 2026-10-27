// Reporting moderation (T9.5): types, labels and wording shared by the staff
// panel and the citizen's status screen. Pure: the server decides everything
// (who may act, strikes, expiry); this only presents its answers.

import type { Result } from "../domain";

export const MAX_STRIKES = 3;
export const RESTRICTION_DAYS = 30;

export type ModerationReason = "SPAM_INVALID" | "FALSE_REPORT" | "INAPPROPRIATE_CONTENT" | "HARASSMENT" | "MANIPULATED_EVIDENCE" | "OTHER";
export const MODERATION_REASONS: readonly ModerationReason[] = ["SPAM_INVALID", "FALSE_REPORT", "INAPPROPRIATE_CONTENT", "HARASSMENT", "MANIPULATED_EVIDENCE", "OTHER"];
export const REASON_LABEL: Record<ModerationReason, string> = {
  SPAM_INVALID: "Spam / repeated invalid reports",
  FALSE_REPORT: "Deliberately false report",
  INAPPROPRIATE_CONTENT: "Inappropriate content",
  HARASSMENT: "Harassment / abusive behaviour",
  MANIPULATED_EVIDENCE: "Manipulated evidence",
  OTHER: "Other",
};

export type ModerationStatus = "ACTIVE" | "TEMPORARILY_RESTRICTED" | "INDEFINITELY_RESTRICTED";

/** What the citizen may see about their own account (no notes, no staff identities). */
export type CitizenModeration = {
  status: ModerationStatus;
  restrictedUntil?: string;
  restrictedSince?: string;
  reason?: ModerationReason;
  strikes: number;
  maxStrikes: number;
};

export type ModerationHistoryEntry = {
  id: string;
  type: "RESTRICTION_ISSUED" | "RESTRICTION_REVOKED";
  createdAt: string;
  actorRole: "OFFICER" | "SUPERVISOR" | "ADMIN";
  /** Only for staff of the viewer's own organization. */
  actorName?: string;
  sameOrganization: boolean;
  reason?: ModerationReason;
  /** Staff-only. */
  internalNote?: string;
  cycle: number;
  strikeInCycle?: number;
  lifetimeStrike?: number;
  indefinite: boolean;
  expiresAt?: string;
  revokesActionId?: string;
  /** Staff-only. */
  revokeReason?: string;
  revokedAt?: string;
};

/** Staff view of one reporter (pseudonymous reference only). */
export type StaffModeration = CitizenModeration & {
  citizenRef: string;
  cycle: number;
  lifetimeStrikes: number;
  activeActionId?: string;
  history: ModerationHistoryEntry[];
};

export type ModerationApi = {
  getMine(): Promise<Result<CitizenModeration>>;
  getForCase(caseId: string): Promise<Result<StaffModeration>>;
  restrict(caseId: string, reason: ModerationReason, note: string | null, requestId: string): Promise<Result<StaffModeration & { changed: boolean }>>;
  revoke(caseId: string, actionId: string, reason: string, requestId: string): Promise<Result<StaffModeration & { changed: boolean }>>;
};

/** One idempotency key per confirmed action (a retry of the same confirmation reuses it). */
export function newModerationRequestId(): string {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) return "mod-" + Array.from(c.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
  return `mod-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export const isRestricted = (m: Pick<CitizenModeration, "status">) => m.status !== "ACTIVE";

export function formatModerationDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

export const strikeText = (strikes: number, max = MAX_STRIKES) => `${Math.min(strikes, max)} of ${max}`;

// ---------------------------------------------------------------------------
// Staff wording

export const STAFF_STATUS_LABEL: Record<ModerationStatus, string> = {
  ACTIVE: "Reporting allowed",
  TEMPORARILY_RESTRICTED: "Reporting restricted (30 days)",
  INDEFINITELY_RESTRICTED: "Reporting restricted indefinitely",
};

export function restrictConfirmCopy(m: Pick<StaffModeration, "strikes">): { title: string; body: string; third: boolean } {
  const next = m.strikes + 1;
  const third = next >= MAX_STRIKES;
  return {
    title: third ? "Indefinitely restrict this user's reporting access?" : `Restrict this user's reporting access for ${RESTRICTION_DAYS} days?`,
    body: third
      ? `This will be strike ${next} of ${MAX_STRIKES}. This is the user's third restriction. Confirming will indefinitely restrict their reporting access until an officer or administrator restores it.`
      : `This will be strike ${next} of ${MAX_STRIKES}. The user can sign in and see their reports, but cannot submit new reports for ${RESTRICTION_DAYS} days.`,
    third,
  };
}

export function revokeConfirmCopy(m: Pick<StaffModeration, "status">): { title: string; body: string } {
  return m.status === "INDEFINITELY_RESTRICTED"
    ? {
        title: "Restore this user's reporting access?",
        body: "Reporting access is restored immediately. The restriction stays in the history; the user starts a new strike count (lifetime strikes are kept).",
      }
    : {
        title: "Lift this restriction now?",
        body: "Reporting access is restored immediately. The restriction stays in the history and still counts as a strike.",
      };
}

/** Validation the server also enforces. */
export function restrictInputError(reason: ModerationReason | null, note: string): string | null {
  if (!reason) return "Choose a reason.";
  if (reason === "OTHER" && note.trim().length < 3) return "Describe the reason in a note.";
  if (note.trim().length > 500) return "Keep the note under 500 characters.";
  return null;
}
export function revokeInputError(reason: string): string | null {
  const t = reason.trim();
  if (t.length < 3) return "Give a reason for lifting the restriction.";
  if (t.length > 500) return "Keep the reason under 500 characters.";
  return null;
}

// ---------------------------------------------------------------------------
// Citizen wording (professional; no criminal or official-sanction language)

export function citizenRestrictionCopy(m: CitizenModeration): { title: string; lines: string[] } | null {
  if (m.status === "ACTIVE") return null;
  const reason = m.reason ? REASON_LABEL[m.reason] : undefined;
  if (m.status === "TEMPORARILY_RESTRICTED") {
    return {
      title: "Reporting temporarily restricted",
      lines: [
        `You can't submit new reports until ${formatModerationDate(m.restrictedUntil)}.`,
        ...(reason ? [`Reason: ${reason}.`] : []),
        `Restrictions on this account: ${strikeText(m.strikes, m.maxStrikes)}.`,
        `Repeated misuse of reporting may lead to an indefinite restriction. You can still sign in and see your earlier reports.`,
      ],
    };
  }
  return {
    title: "Reporting access restricted",
    lines: [
      "This account can no longer submit reports unless the restriction is reviewed and lifted by ParkWatch staff.",
      ...(reason ? [`Reason for the latest restriction: ${reason}.`] : []),
      `Restrictions on this account: ${strikeText(m.strikes, m.maxStrikes)}.`,
      "You can still sign in and see your earlier reports.",
    ],
  };
}
