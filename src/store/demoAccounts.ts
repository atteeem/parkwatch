// DISPLAY-ONLY demo identities for the two development sessions. One source
// for every screen that shows "who is signed in", so the demo never mixes
// names. Real accounts replace this together with src/store/session.ts.

export const DEMO_CITIZEN_ACCOUNT = {
  fullName: "Mika Salo",
  firstName: "Mika",
  city: "Helsinki, Finland",
  memberSince: "July 2026",
} as const;

export const DEMO_OFFICER_ACCOUNT = {
  fullName: "Mikko Virtanen",
  firstName: "Mikko",
  unit: "Helsinki Parking Enforcement",
  badge: "Officer ID #295",
  district: "Kauppatori & City Center, Helsinki",
} as const;
