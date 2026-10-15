// What closing a citizen account does (T9.3). Must match the server function
// request_account_deletion (20261015000001_account_deletion.sql) and
// docs/DATA_RETENTION.md. Final legal wording: Privacy Policy (draft).

export const ACCOUNT_DELETION_COPY = {
  title: "Close account",
  intro: "Closing your account can't be undone.",
  removedHeading: "Removed now",
  removed: [
    "Your name and profile picture",
    "Your notifications",
    "Push notifications to your devices",
    "Use of this account: it can't be used for ParkWatch again",
  ],
  afterwards: "Your email address and password are then deleted from the sign-in system by ParkWatch.",
  keptHeading: "Kept by the enforcement organization",
  kept: [
    "Reports you already sent, with their photos and outcomes, without your name. They are records of parking enforcement decisions.",
  ],
  rewardWarning: (euros: string) => `Your reward balance (${euros}) will be lost. Payouts are not available yet.`,
  confirmLabel: "Type DELETE to confirm",
  confirmWord: "DELETE",
  action: "Close my account",
  dialogTitle: "Close your account?",
  dialogBody: "Your personal details are removed and you will be signed out. This can't be undone.",
  staffNote: "Officer and staff accounts are managed by your organization. Ask your administrator to close this account.",
  demoNote: "Accounts can't be closed in the demo.",
} as const;
