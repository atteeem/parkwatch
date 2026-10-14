// What the console offers for a case's assignment (T9.2). The server decides
// (admin_assign_case / admin_unassign_case); this only avoids offering
// actions it would refuse, and explains why.

import type { CaseStatus } from "../domain";
import type { AdminAssignableOfficer } from "./adminTypes";

export type AssignmentOptions = {
  /** NEW: pick an officer. */
  assign: boolean;
  /** ASSIGNED, not started: pick another officer. */
  reassign: boolean;
  /** ASSIGNED, not started: back to the queue. */
  returnToQueue: boolean;
  /** Why nothing can be changed (started / completed), else null. */
  lockedReason: string | null;
};

export function assignmentOptions(status: CaseStatus): AssignmentOptions {
  switch (status) {
    case "NEW":
      return { assign: true, reassign: false, returnToQueue: false, lockedReason: null };
    case "ASSIGNED":
      return { assign: false, reassign: true, returnToQueue: true, lockedReason: null };
    case "COMPLETED":
      return { assign: false, reassign: false, returnToQueue: false, lockedReason: "The case is completed." };
    default:
      return {
        assign: false,
        reassign: false,
        returnToQueue: false,
        lockedReason: "The officer has started this case, so it can't be moved from the console. Contact the officer directly.",
      };
  }
}

/** Officers to offer: everyone eligible except the current assignee; fewest active cases first. */
export function pickerOfficers(list: readonly AdminAssignableOfficer[]): AdminAssignableOfficer[] {
  return list
    .filter((o) => !o.isCurrent)
    .slice()
    .sort((a, b) => a.activeCases - b.activeCases || (a.displayName ?? "").localeCompare(b.displayName ?? ""));
}

export const officerLabel = (o: Pick<AdminAssignableOfficer, "displayName">) => o.displayName ?? "Unnamed officer";

export function confirmCopy(kind: "assign" | "reassign" | "return", target: string | undefined, current: string | undefined) {
  switch (kind) {
    case "assign":
      return { title: "Assign case", message: `Assign this case to ${target}? They will be notified.`, confirm: "Assign" };
    case "reassign":
      return {
        title: "Reassign case",
        message: `Move this case from ${current ?? "the current officer"} to ${target}? ${target} will be notified; ${current ?? "the current officer"} will see that the case was moved.`,
        confirm: "Reassign",
      };
    case "return":
      return {
        title: "Return to queue",
        message: `Take this case away from ${current ?? "the current officer"} and put it back in the queue for any officer?`,
        confirm: "Return to queue",
      };
  }
}
