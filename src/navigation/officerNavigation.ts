// Officer stack resets after a case is decided. After completion nothing
// actionable for that case may remain behind on the stack (no "back" into a
// stale inspection), so the stack is rebuilt as [Home, <target>].

type StackRouter = {
  canDismiss(): boolean;
  dismissAll(): void;
  replace(href: any): void;
  push(href: any): void;
};

export function resetToOfficerHome(router: StackRouter): void {
  if (router.canDismiss()) router.dismissAll();
  router.replace("/officer/home");
}

/** After a successful completion: [Home, Inspection Completed (OFF-09)]. */
export function showCompletedCase(router: StackRouter, caseId: string): void {
  resetToOfficerHome(router);
  router.push({ pathname: "/officer/inspection-completed", params: { id: caseId } });
}

/** "Next Case" from OFF-09: [Home, Report Details of the next case]. */
export function openNextCase(router: StackRouter, caseId: string): void {
  resetToOfficerHome(router);
  router.push({ pathname: "/officer/report-details", params: { id: caseId } });
}
