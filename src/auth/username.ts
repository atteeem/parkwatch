// Citizen username (T9.4): a public handle, separate from display_name (the
// person's private name). The server function set_username() is the authority
// for every rule here (format, reserved names, uniqueness, 30-day cooldown on
// server time); this module only gives instant feedback and formats dates.

export const USERNAME_COOLDOWN_DAYS = 30;
const DAY_MS = 86_400_000;

/** Same normalization as public.pw_normalize_username: trim, lowercase. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Error text for the form, or null when the server should be asked. */
export function validateUsername(raw: string): string | null {
  const v = normalizeUsername(raw);
  if (!v) return "Choose a username.";
  if (v.length < 3 || v.length > 24) return "Use 3–24 characters.";
  if (!/^[a-z0-9_]+$/.test(v)) return "Use only letters a–z, numbers and underscore (no spaces).";
  return null;
}

/** What set_username() answered. */
export type UsernameOutcome =
  | { kind: "CHANGED"; username: string; nextChangeAt: string }
  | { kind: "UNCHANGED"; username: string; nextChangeAt?: string }
  | { kind: "COOLDOWN"; nextChangeAt: string }
  | { kind: "TAKEN" }
  | { kind: "INVALID" }
  | { kind: "UNAVAILABLE" };

export function usernameOutcomeMessage(o: UsernameOutcome): string {
  switch (o.kind) {
    case "CHANGED":
      return `Your username is now @${o.username}.`;
    case "UNCHANGED":
      return `@${o.username} is already your username.`;
    case "COOLDOWN":
      return `You can change your username again on ${formatChangeDate(o.nextChangeAt)}.`;
    case "TAKEN":
      return "That username is taken. Try another one.";
    case "INVALID":
      return "Use 3–24 characters: letters a–z, numbers and underscore.";
    case "UNAVAILABLE":
      return "This username is not available. Try another one.";
  }
}

/** Profile hint from the server timestamp. The server decides; this only explains. */
export function usernameChangeStatus(changedAt: string | undefined, now: Date = new Date()): { canChange: boolean; nextChangeAt?: string; daysLeft?: number } {
  if (!changedAt) return { canChange: true };
  const next = new Date(new Date(changedAt).getTime() + USERNAME_COOLDOWN_DAYS * DAY_MS);
  if (Number.isNaN(next.getTime()) || next.getTime() <= now.getTime()) return { canChange: true };
  return { canChange: false, nextChangeAt: next.toISOString(), daysLeft: Math.ceil((next.getTime() - now.getTime()) / DAY_MS) };
}

export function formatChangeDate(iso: string): string {
  const d = new Date(iso);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/** One-line Profile subtitle. */
export function usernameRowSubtitle(username: string | undefined, changedAt: string | undefined, now: Date = new Date()): string {
  if (!username) return "Choose a public username";
  const s = usernameChangeStatus(changedAt, now);
  if (s.canChange || !s.nextChangeAt) return `@${username} · you can change it`;
  return `@${username} · can change again on ${formatChangeDate(s.nextChangeAt)} (${s.daysLeft} ${s.daysLeft === 1 ? "day" : "days"})`;
}
