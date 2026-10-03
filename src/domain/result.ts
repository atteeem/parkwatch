// Domain operations never throw for business-rule violations and never
// silently mutate. They return a Result so callers (the store, later an API)
// can handle failures predictably.

export type DomainErrorCode =
  | "INVALID_TRANSITION"
  | "ALREADY_COMPLETED"
  | "INSPECTION_NOT_READY"
  | "INSPECTION_COMPLETED"
  | "EVIDENCE_SOURCE_MISMATCH"
  | "REPORT_ALREADY_RESOLVED"
  | "REWARD_VOIDED"
  | "NO_PENDING_REWARD"
  | "INVALID_AMOUNT"
  | "BELOW_MINIMUM"
  | "INSUFFICIENT_AVAILABLE_BALANCE"
  | "MISSING_OFFICER"
  | "CASE_REPORT_MISMATCH"
  | "INVALID_DRAFT";

export type DomainError = { code: DomainErrorCode; message: string };

export type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const fail = <T = never>(code: DomainErrorCode, message: string): Result<T> => ({
  ok: false,
  error: { code, message },
});
