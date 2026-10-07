// Unsent report draft persistence (server-backed mode, T8.4).
//
// The draft is kept on this phone, per signed-in user, until the server has
// accepted the report (or the user discards it). It holds the immutable
// draft id (= the server submission id, so a retry after a crash or restart
// can never create a second report), the citizen's inputs, the LOCAL photo
// URIs, and which photo uploads have already finished.
//
// Nothing is uploaded in the background: the user continues and submits.

import { ReportDraft } from "../domain";
import type { KeyValueStorage } from "../store/persistence";

export const DRAFT_STORAGE_VERSION = 1;

export type PersistedDraft = {
  version: typeof DRAFT_STORAGE_VERSION;
  userId: string;
  draft: ReportDraft;
  /** Storage paths of this submission whose upload has finished. */
  uploaded: string[];
  savedAt: string;
};

export const draftStorageKey = (userId: string) => `parkwatch.unsentReport.v${DRAFT_STORAGE_VERSION}.${userId}`;

const DRAFT_ID = /^[A-Za-z0-9_-]{1,100}$/;

/** Something worth keeping was entered (an empty wizard is not a draft). */
export function hasDraftContent(d: ReportDraft): boolean {
  return (
    Object.values(d.photos).some(Boolean) ||
    !!d.violationId ||
    d.location.address.trim().length > 0 ||
    !!d.location.coordinates ||
    d.notes.trim().length > 0 ||
    d.attachments.length > 0
  );
}

function isPersistedDraft(v: unknown, userId: string): v is PersistedDraft {
  const p = v as PersistedDraft;
  return (
    !!p &&
    p.version === DRAFT_STORAGE_VERSION &&
    p.userId === userId &&
    !!p.draft &&
    typeof p.draft.draftId === "string" &&
    DRAFT_ID.test(p.draft.draftId) &&
    typeof p.draft.photos === "object" &&
    !!p.draft.location &&
    typeof p.draft.location.address === "string" &&
    typeof p.draft.notes === "string" &&
    Array.isArray(p.draft.attachments) &&
    Array.isArray(p.uploaded) &&
    p.uploaded.every((x) => typeof x === "string")
  );
}

export async function loadPersistedDraft(storage: KeyValueStorage, userId: string): Promise<PersistedDraft | null> {
  try {
    const raw = await storage.getItem(draftStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Another user's or a malformed record is never restored.
    return isPersistedDraft(parsed, userId) ? parsed : null;
  } catch {
    return null;
  }
}

export async function savePersistedDraft(storage: KeyValueStorage, rec: Omit<PersistedDraft, "version" | "savedAt">, at: Date = new Date()): Promise<void> {
  const value: PersistedDraft = { version: DRAFT_STORAGE_VERSION, savedAt: at.toISOString(), ...rec };
  await storage.setItem(draftStorageKey(rec.userId), JSON.stringify(value));
}

export async function clearPersistedDraft(storage: KeyValueStorage, userId: string): Promise<void> {
  await storage.removeItem(draftStorageKey(userId));
}

export type WizardRoute = "/user/report/photos" | "/user/report/select-violation" | "/user/report/add-details" | "/user/report/review";

/** Where "Continue" lands: the first step that still needs input. */
export function resumeRoute(d: ReportDraft): WizardRoute {
  if (!d.photos.FRONT || !d.photos.SIDE || !d.photos.REAR) return "/user/report/photos";
  if (!d.violationId) return "/user/report/select-violation";
  if (!d.location.address.trim()) return "/user/report/add-details";
  return "/user/report/review";
}
