// Private evidence storage (Supabase Storage). The ONLY code that touches
// storage. Buckets are private: photos are shown through short-lived signed
// URLs, never public URLs.
//
// Paths (enforced again by storage policies on the server):
//   report-evidence:  <citizen uid>/<submission id>/<evidence id>.<ext>
//   officer-evidence: <case uuid>/<evidence id>.<ext>
// Paths are deterministic per evidence id, so a retry after a lost response
// re-uses the same object ("already exists" counts as uploaded).

import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError, fail, ok, Result } from "../../domain";
import { EVIDENCE_BUCKETS, EvidenceBucket } from "../mappers/common";
import { isAlreadyExists, isNetworkFailure, RawServerError } from "../operations/rpcErrors";

export { EVIDENCE_BUCKETS };
export type { EvidenceBucket };

/** Signed URLs live this long; screens refresh them on every data refresh. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

/** Reads a captured photo (file://, content://, blob: ...) into bytes. Injectable for tests. */
export type ReadLocalFile = (uri: string) => Promise<ArrayBuffer>;

export const readLocalFile: ReadLocalFile = async (uri) => {
  const res = await fetch(uri);
  if (!res.ok && res.status !== 0) throw new Error("read failed");
  return res.arrayBuffer();
};

const EXT_TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic" };

/** File extension + content type from the device URI (JPEG unless clearly something else). */
export function imageTypeOf(uri: string): { ext: string; contentType: string } {
  const m = /\.([a-z0-9]{3,4})(?:[?#]|$)/i.exec(uri);
  const ext = m?.[1]?.toLowerCase() ?? "";
  if (EXT_TYPES[ext]) return { ext: ext === "jpeg" ? "jpg" : ext, contentType: EXT_TYPES[ext] };
  return { ext: "jpg", contentType: "image/jpeg" };
}

/** Only letters, digits, "_" and "-" survive in a path segment. */
export const safeSegment = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100);

export const reportEvidencePath = (citizenUid: string, submissionId: string, evidenceId: string, ext: string) =>
  `${citizenUid}/${safeSegment(submissionId)}/${safeSegment(evidenceId)}.${ext}`;

export const officerEvidencePath = (caseUuid: string, evidenceId: string, ext: string) => `${caseUuid}/${safeSegment(evidenceId)}.${ext}`;

/** Storage answers 401 (or a JWT message) when the session expired: that is a sign-in problem, not a bad photo. */
const isAuthFailure = (e: RawServerError | null | undefined) =>
  e?.status === 401 || String(e?.statusCode ?? "") === "401" || /jwt|token.*(expired|invalid)|invalid.*token|unauthori[sz]ed/i.test(String(e?.message ?? "")) && !/row-level security/i.test(String(e?.message ?? ""));

const uploadError = (e: RawServerError | null | undefined): DomainError =>
  isNetworkFailure(e)
    ? { code: "NETWORK_ERROR", message: "NETWORK_ERROR" }
    : isAuthFailure(e)
      ? { code: "UNAUTHENTICATED", message: "UNAUTHENTICATED" }
      : { code: "UPLOAD_FAILED", message: "UPLOAD_FAILED" };

export type EvidenceStorage = {
  /** Upload one captured photo. `created` is false when the object already existed (a retry). */
  upload(bucket: EvidenceBucket, path: string, localUri: string): Promise<Result<{ created: boolean }>>;
  /** Best-effort cleanup of objects that were never attached (the server refuses to delete attached evidence). */
  remove(bucket: EvidenceBucket, paths: string[]): Promise<void>;
  /** Short-lived signed URLs for objects the caller may read; unreadable paths are simply absent. */
  sign(bucket: EvidenceBucket, paths: string[]): Promise<Record<string, string>>;
};

export function createEvidenceStorage(client: SupabaseClient, readFile: ReadLocalFile = readLocalFile): EvidenceStorage {
  return {
    async upload(bucket, path, localUri) {
      let bytes: ArrayBuffer;
      try {
        bytes = await readFile(localUri);
      } catch {
        return fail("UPLOAD_FAILED", "UPLOAD_FAILED");
      }
      try {
        const { error } = await client.storage.from(bucket).upload(path, bytes, { contentType: imageTypeOf(localUri).contentType, upsert: false });
        if (!error) return ok({ created: true });
        if (isAlreadyExists(error as RawServerError)) return ok({ created: false });
        return { ok: false, error: uploadError(error as RawServerError) };
      } catch (e) {
        return { ok: false, error: uploadError(e as RawServerError) };
      }
    },

    async remove(bucket, paths) {
      if (paths.length === 0) return;
      try {
        await client.storage.from(bucket).remove(paths);
      } catch {
        // Cleanup is best effort: an orphaned private object is harmless and unreadable to others.
      }
    },

    async sign(bucket, paths) {
      const unique = [...new Set(paths)];
      if (unique.length === 0) return {};
      try {
        const { data, error } = await client.storage.from(bucket).createSignedUrls(unique, SIGNED_URL_TTL_SECONDS);
        if (error || !data) return {};
        const out: Record<string, string> = {};
        for (const item of data) if (item.path && item.signedUrl && !item.error) out[item.path] = item.signedUrl;
        return out;
      } catch {
        return {};
      }
    },
  };
}
