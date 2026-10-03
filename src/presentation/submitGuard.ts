// Guards a one-shot submit action (e.g. Submit Report, Confirm Withdrawal)
// against double taps. While a submission is running, or after it
// succeeded, further taps are ignored. A failure unlocks it so the user can
// retry; the caller's draft/input is never touched by the guard.

import { DomainError, Result } from "../domain";

export type SubmitGuard = {
  run<T>(
    submit: () => Result<T>,
    handlers: { onSuccess: (value: T) => void; onError: (error: DomainError) => void }
  ): "submitted" | "failed" | "ignored";
  isLocked(): boolean;
};

export function createSubmitGuard(): SubmitGuard {
  let state: "idle" | "running" | "done" = "idle";
  return {
    run<T>(
      submit: () => Result<T>,
      { onSuccess, onError }: { onSuccess: (value: T) => void; onError: (error: DomainError) => void }
    ) {
      if (state !== "idle") return "ignored";
      state = "running";
      let result: Result<T>;
      try {
        result = submit();
      } catch (e) {
        state = "idle"; // unlock so the user can retry, but don't disguise a bug as a domain error
        throw e;
      }
      if (!result.ok) {
        state = "idle";
        onError(result.error);
        return "failed";
      }
      state = "done";
      onSuccess(result.value);
      return "submitted";
    },
    isLocked: () => state !== "idle",
  };
}
