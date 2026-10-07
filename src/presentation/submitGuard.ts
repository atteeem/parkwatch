// Guards a one-shot submit action (e.g. Submit Report, Confirm Withdrawal)
// against double taps. While a submission is running, or after it
// succeeded, further taps are ignored. A failure unlocks it so the user can
// retry; the caller's draft/input is never touched by the guard.
//
// The action may be synchronous (local demo store) or return a Promise
// (server-backed mode). Either way the handlers run exactly once, and the
// guard stays locked until the promise settles.

import { DomainError, Result } from "../domain";

/** What every core action returns: the local store answers at once, the server later. */
export type ActionResult<T> = Result<T> | Promise<Result<T>>;

type Handlers<T> = { onSuccess: (value: T) => void; onError: (error: DomainError) => void };

export type SubmitGuard = {
  /** "pending" = an async action is running; its handler will be called when it settles. */
  run<T>(submit: () => ActionResult<T>, handlers: Handlers<T>): "submitted" | "failed" | "ignored" | "pending";
  isLocked(): boolean;
};

const UNEXPECTED: DomainError = { code: "BACKEND_ERROR", message: "Unexpected failure." };

export function createSubmitGuard(): SubmitGuard {
  let state: "idle" | "running" | "done" = "idle";

  const settle = <T>(result: Result<T>, { onSuccess, onError }: Handlers<T>): "submitted" | "failed" => {
    if (!result.ok) {
      state = "idle";
      onError(result.error);
      return "failed";
    }
    state = "done";
    onSuccess(result.value);
    return "submitted";
  };

  return {
    run<T>(submit: () => ActionResult<T>, handlers: Handlers<T>) {
      if (state !== "idle") return "ignored";
      state = "running";
      let result: ActionResult<T>;
      try {
        result = submit();
      } catch (e) {
        state = "idle"; // unlock so the user can retry, but don't disguise a bug as a domain error
        throw e;
      }
      if (!(result instanceof Promise)) return settle(result, handlers);
      result.then(
        (r) => settle(r, handlers),
        () => settle<T>({ ok: false, error: UNEXPECTED }, handlers)
      );
      return "pending";
    },
    isLocked: () => state !== "idle",
  };
}
