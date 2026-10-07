// Server functions report rule failures as "CODE: message" (pw_fail in the
// migration). This maps them, and transport/database failures, to domain
// error codes. Raw server text is never shown: screens get the code and
// presentation/errors.ts supplies the wording.

import { DomainError, DomainErrorCode } from "../../domain";

/** Codes the server functions may raise on purpose. Anything else is BACKEND_ERROR. */
const SERVER_RULE_CODES: readonly DomainErrorCode[] = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CASE_TAKEN",
  "ALREADY_COMPLETED",
  "INVALID_TRANSITION",
  "INSPECTION_NOT_READY",
  "INVALID_DRAFT",
  "EVIDENCE_NOT_UPLOADED",
  "NO_JURISDICTION",
];

/** Only the fields we read from a supabase-js / PostgREST / Storage error. */
export type RawServerError = {
  code?: string | null;
  message?: string | null;
  status?: number | null;
  statusCode?: string | number | null;
  name?: string | null;
};

const err = (code: DomainErrorCode): DomainError => ({ code, message: code });

/** A request that never reached the server (offline, DNS, refused, aborted). */
export function isNetworkFailure(e: RawServerError | null | undefined, status?: number): boolean {
  const msg = String(e?.message ?? "");
  if (/failed to fetch|network request failed|networkerror|fetch failed|load failed|ECONNREFUSED|ENOTFOUND|aborted/i.test(msg)) return true;
  return !e?.code && (status === 0 || e?.status === 0);
}

export function mapRpcError(e: RawServerError | null | undefined, status?: number): DomainError {
  if (isNetworkFailure(e, status)) return err("NETWORK_ERROR");
  const code = String(e?.code ?? "");
  const message = String(e?.message ?? "");
  if (code === "P0001") {
    const prefix = message.split(":", 1)[0].trim() as DomainErrorCode;
    if (SERVER_RULE_CODES.includes(prefix)) return err(prefix);
    return err("BACKEND_ERROR");
  }
  const httpStatus = status ?? e?.status ?? undefined;
  if (code === "PGRST301" || code === "PGRST302" || httpStatus === 401) return err("UNAUTHENTICATED");
  if (code === "42501" || httpStatus === 403) return err("FORBIDDEN");
  if (code === "22P02" || code === "PGRST116" || httpStatus === 404) return err("NOT_FOUND");
  return err("BACKEND_ERROR");
}

/** Storage-js errors: "already exists" is a success for our deterministic upload paths. */
export function isAlreadyExists(e: RawServerError | null | undefined): boolean {
  if (!e) return false;
  return e.status === 409 || String(e.statusCode ?? "") === "409" || /already exists|duplicate/i.test(String(e.message ?? ""));
}
