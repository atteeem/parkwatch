// Shared mapping helpers: storage references, ids, cents.

import { backendFail, backendOk, BackendResult } from "../result";

/** Private Supabase Storage buckets (created in T8.2). Never public. */
export const EVIDENCE_BUCKETS = { citizen: "report-evidence", officer: "officer-evidence" } as const;
export type EvidenceBucket = (typeof EVIDENCE_BUCKETS)[keyof typeof EVIDENCE_BUCKETS];

const STORAGE_PATH = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,255}$/;

/** A storage object path inside a bucket. Device URIs (file://, content://, http...) are never storage paths. */
export function validateStoragePath(path: string): BackendResult<string> {
  if (!STORAGE_PATH.test(path) || path.includes("..") || path.includes("://")) {
    return backendFail("INVALID_DATA", "Evidence must be uploaded before it is saved (a storage path, not a device file).");
  }
  return backendOk(path);
}

/**
 * Domain evidence carries a `uri`. Evidence read from the backend gets a
 * storage reference URI; T8.2 resolves it to a short-lived signed URL.
 */
import { STORAGE_URI_SCHEME } from "../../data/storageUri";
export { STORAGE_URI_SCHEME };
export const storageUri = (bucket: EvidenceBucket, path: string) => `${STORAGE_URI_SCHEME}${bucket}/${path}`;

export function parseStorageUri(uri: string): { bucket: string; path: string } | null {
  if (!uri.startsWith(STORAGE_URI_SCHEME)) return null;
  const rest = uri.slice(STORAGE_URI_SCHEME.length);
  const slash = rest.indexOf("/");
  return slash > 0 ? { bucket: rest.slice(0, slash), path: rest.slice(slash + 1) } : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (s: string | undefined | null): s is string => !!s && UUID.test(s);

/** Money must stay integer cents end to end. */
export function requireCents(value: number, what: string): BackendResult<number> {
  return Number.isSafeInteger(value) && value > 0 ? backendOk(value) : backendFail("INVALID_DATA", `${what} must be a positive whole number of cents.`);
}

/** null-ish -> undefined for optional domain fields. */
export const opt = <T>(v: T | null | undefined): T | undefined => (v === null || v === undefined ? undefined : v);
