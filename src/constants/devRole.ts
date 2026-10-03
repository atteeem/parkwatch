// The real product determines the role from login/account. For this MVP,
// development starts directly in one role. Flip this (or set
// EXPO_PUBLIC_START_ROLE in a .env file) to boot into the other app.
export type Role = "user" | "officer";

export const DEV_ROLE: Role =
  (process.env.EXPO_PUBLIC_START_ROLE as Role | undefined) ?? "user";
