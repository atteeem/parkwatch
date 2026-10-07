// Typed backend results. Screens/stores never see raw PostgREST/Postgres
// errors: everything is mapped to one of these codes with a safe message.

export type BackendErrorCode =
  | "BACKEND_NOT_CONFIGURED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_DATA"
  | "BACKEND_ERROR";

export type BackendError = { code: BackendErrorCode; message: string };
export type BackendResult<T> = { ok: true; value: T } | { ok: false; error: BackendError };

export const backendOk = <T>(value: T): BackendResult<T> => ({ ok: true, value });
export const backendFail = <T = never>(code: BackendErrorCode, message: string): BackendResult<T> => ({
  ok: false,
  error: { code, message },
});

const SAFE_MESSAGE: Record<BackendErrorCode, string> = {
  BACKEND_NOT_CONFIGURED: "The ParkWatch server is not configured in this build.",
  UNAUTHENTICATED: "Please sign in again.",
  FORBIDDEN: "You don't have access to this.",
  NOT_FOUND: "We couldn't find that item.",
  CONFLICT: "This was already recorded.",
  INVALID_DATA: "Some details are not valid.",
  BACKEND_ERROR: "Something went wrong on the server. Please try again.",
};

/** Shape of errors returned by supabase-js / PostgREST (only the fields we read). */
export type RawBackendError = { code?: string | null; message?: string | null; status?: number | null };

/**
 * Map a raw Supabase/PostgREST/Postgres error to a typed code. The raw
 * message is NOT passed through (it can contain SQL, table or column names).
 */
export function mapBackendError(raw: RawBackendError | null | undefined, status?: number): BackendError {
  const code = raw?.code ?? "";
  const httpStatus = status ?? raw?.status ?? undefined;
  let mapped: BackendErrorCode = "BACKEND_ERROR";
  if (code === "23505") mapped = "CONFLICT"; // unique_violation (idempotency keys, one-per-x)
  else if (code === "42501" || httpStatus === 403) mapped = "FORBIDDEN"; // insufficient_privilege / RLS
  else if (code === "PGRST116" || httpStatus === 404) mapped = "NOT_FOUND";
  else if (code === "PGRST301" || code === "PGRST302" || httpStatus === 401) mapped = "UNAUTHENTICATED";
  else if (code === "23514" || code === "23502" || code === "22P02" || code === "23503") mapped = "INVALID_DATA";
  return { code: mapped, message: SAFE_MESSAGE[mapped] };
}

export const notConfigured = <T = never>(): BackendResult<T> => backendFail("BACKEND_NOT_CONFIGURED", SAFE_MESSAGE.BACKEND_NOT_CONFIGURED);
