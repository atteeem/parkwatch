import { Result } from "../result";

export * from "../index";

/** Unwrap an ok Result or fail the test with the domain error. */
export function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`Expected ok, got ${r.error.code}: ${r.error.message}`);
  return r.value;
}

export function errorCode<T>(r: Result<T>): string | undefined {
  return r.ok ? undefined : r.error.code;
}
