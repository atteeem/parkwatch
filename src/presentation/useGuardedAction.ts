// React binding for the submit guard: one action at a time per screen stage,
// plus a `busy` flag while an asynchronous (server) action is running so the
// screen can show progress and keep its buttons disabled.

import { useMemo, useState } from "react";
import { DomainError } from "../domain";
import { ActionResult, createSubmitGuard } from "./submitGuard";

export function useGuardedAction(resetKey?: unknown) {
  // A new guard per stage (e.g. per case status): a finished stage stays locked.
  const guard = useMemo(() => createSubmitGuard(), [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false);

  function run<T>(submit: () => ActionResult<T>, handlers: { onSuccess: (value: T) => void; onError: (error: DomainError) => void }) {
    const outcome = guard.run(submit, {
      onSuccess: (v) => {
        setBusy(false);
        handlers.onSuccess(v);
      },
      onError: (e) => {
        setBusy(false);
        handlers.onError(e);
      },
    });
    if (outcome === "pending") setBusy(true);
    return outcome;
  }

  return { busy, run, isLocked: () => guard.isLocked() };
}
