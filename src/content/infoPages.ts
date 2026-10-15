// Informational pages (T8.6). Pure data so the wording is tested without UI.
// Rules: describe only what this build actually does; no legal text is
// presented as final; nothing promises a feature, date or result.

export type InfoSection = { heading: string; paragraphs?: string[]; bullets?: string[] };

export type InfoPageId = "help" | "about" | "privacy-data" | "terms" | "privacy-policy" | "officer-help";

export type InfoPage = {
  id: InfoPageId;
  title: string;
  subtitle: string;
  /** Shown as a prominent banner (e.g. draft legal text). */
  notice?: { label: string; text: string };
  sections: InfoSection[];
};

/** Banner label shared by the two legal placeholders. */
export const DRAFT_LEGAL_LABEL = "Draft · pre-launch";

const HELP: InfoPage = {
  id: "help",
  title: "Help Center",
  subtitle: "How reporting, rewards and parking work in ParkWatch",
  sections: [
    {
      heading: "Reporting a parking issue",
      bullets: [
        "Tap Report in the bottom bar and take three photos of the vehicle: front, side and rear.",
        "Choose the type of violation, confirm the location and add notes if they help.",
        "Review everything and submit. You can follow the report under Reports.",
      ],
    },
    {
      heading: "What happens after you submit",
      paragraphs: [
        "An enforcement officer reviews the report and may inspect the location. The officer decides the outcome; ParkWatch does not make enforcement decisions automatically.",
        "An officer may verify the report, reject it, or close the case for another reason (for example, the vehicle had moved or had a valid permit).",
        "Verified and rejected reports update the report's status under Reports and send you a notification. When a case is closed for another reason, the report's status currently stays as it is and no outcome notification is sent.",
      ],
    },
    {
      heading: "Rewards",
      paragraphs: [
        "When an eligible report is verified, a €5 reward is added to your wallet. Rejected reports, and cases closed for another reason, do not earn a reward.",
        "Real withdrawals are not available. In the local demo, a simulated withdrawal request can be recorded, but no bank transfer is made.",
      ],
    },
    {
      heading: "Parking",
      paragraphs: ["Parking sessions in this version run on your phone only. No parking operator is connected and no payment is taken."],
    },
    {
      heading: "Location",
      paragraphs: [
        "With your permission, ParkWatch uses your location while relevant report or map screens are open, for example to place a new report on the map. You can also type the address yourself. The app does not track your location in the background.",
      ],
    },
  ],
};

const ABOUT: InfoPage = {
  id: "about",
  title: "About ParkWatch",
  subtitle: "What this app is and what it is not",
  sections: [
    {
      heading: "What ParkWatch does",
      paragraphs: [
        "ParkWatch lets residents report parking problems with photo evidence, and lets enforcement officers review, inspect and resolve those reports.",
      ],
    },
    {
      heading: "Pre-launch version",
      paragraphs: ["This is a pre-launch version of ParkWatch. Features that are not available yet are shown dimmed instead of pretending to work."],
      bullets: [
        "Real withdrawals are not available. In the local demo, a simulated withdrawal request can be recorded, but no bank transfer is made.",
        "Payment methods and identity verification are not available yet.",
        "Parking sessions do not take payments.",
        "Push notifications work in the installed app once you turn them on; they never show photos, places or plates. Email notifications are not available. Every update also appears in the app's Notifications screen.",
      ],
    },
    {
      heading: "Decisions",
      paragraphs: ["Every enforcement outcome is decided by a person. Submitting a report does not mean a parking charge will be issued."],
    },
  ],
};

const PRIVACY_DATA: InfoPage = {
  id: "privacy-data",
  title: "Privacy & Data",
  subtitle: "What the app stores when you use it",
  sections: [
    {
      heading: "Reports",
      paragraphs: [
        "A report contains the photos you take, the violation type, the location (address and, if you allow it, map coordinates), your notes and the time it was submitted.",
        "Report photos are evidence: they are shown to the enforcement officers who handle the report.",
      ],
    },
    {
      heading: "Your account",
      paragraphs: ["When you sign in, your email address identifies your account. Your reports, rewards and notifications are linked to it."],
    },
    {
      heading: "Profile photo",
      paragraphs: [
        "A profile photo is optional. If you add one while signed in, it is stored privately with your account and is not public. You can replace or remove it at any time from your profile.",
        "In the local demo without an account, the photo is kept on this phone only.",
      ],
    },
    {
      heading: "Location",
      paragraphs: [
        "ParkWatch may use your location while relevant report or map screens are open and permission has been granted. The app does not track your location in the background.",
        "When you submit a report, its final location is saved as part of the report: the address and, if available, the map point. The report also records whether that point came from your phone's GPS or was set by you on the map.",
        "If you move the report point on the map, ParkWatch does not separately keep your original GPS position on the server. It stays on your phone only while the report is still a draft.",
      ],
    },
    {
      heading: "Parking and vehicles",
      paragraphs: ["Vehicles you add and parking sessions you start are used to show your parking status in the app. No payment details are collected."],
    },
    {
      heading: "Deleting data",
      paragraphs: [
        "You can close your account in Settings → Delete Account. Your name, profile picture, notifications and push registrations are removed at once; reports you already sent stay with the enforcement organization without your name, because they are records of enforcement decisions. Full details will be in the Privacy Policy, which is still a draft.",
      ],
    },
  ],
};

const TERMS: InfoPage = {
  id: "terms",
  title: "Terms of Service",
  subtitle: "Pre-launch information",
  notice: {
    label: DRAFT_LEGAL_LABEL,
    text: "The final Terms of Service have not been published. This page is a plain-language summary of how the app is meant to be used and is not a legal agreement.",
  },
  sections: [
    {
      heading: "Using ParkWatch fairly",
      bullets: [
        "Report only what you have seen yourself, with your own photos.",
        "Do not submit false, edited or misleading reports.",
        "Do not photograph people more than the report needs.",
      ],
    },
    {
      heading: "Outcomes and rewards",
      paragraphs: [
        "Enforcement officers decide what happens to each report. Rewards depend on a report being verified and eligible; submitting a report does not guarantee a reward.",
        "Payouts of rewards are not available in this version.",
      ],
    },
    {
      heading: "Parking in this version",
      paragraphs: ["Parking sessions in the app are a preview. They do not take payments and are not a valid parking permit."],
    },
    {
      heading: "Your account",
      paragraphs: ["You can close your account at any time in Settings → Delete Account."],
    },
    {
      heading: "To be added before launch",
      bullets: [
        "The service provider's legal name, business ID and contact details",
        "Who may create an account (age and residence requirements)",
        "Reward terms, including how payouts work",
        "Liability, changes to the terms and governing law",
      ],
    },
  ],
};

const PRIVACY_POLICY: InfoPage = {
  id: "privacy-policy",
  title: "Privacy Policy",
  subtitle: "Pre-launch information",
  notice: {
    label: DRAFT_LEGAL_LABEL,
    text: "The final Privacy Policy has not been published. Until it is, Privacy & Data in Settings gives a plain description of what the app stores.",
  },
  sections: [
    {
      heading: "What ParkWatch stores",
      bullets: [
        "Your account: email address, name and an optional profile picture.",
        "Your reports: front, side and rear photos, the reported location and address, the time, the vehicle's plate and your notes.",
        "Rewards and notifications linked to your reports.",
        "If you turn on push notifications: a device token so ParkWatch can reach your phone. Notifications never show photos, places or plates.",
      ],
    },
    {
      heading: "Plate scanning",
      paragraphs: [
        "If you scan a plate, a small cropped image of the plate is sent through ParkWatch's server to a plate-recognition provider (Plate Recognizer, which processes images in the USA) to read the characters. ParkWatch does not store that crop; you always confirm or type the plate yourself.",
      ],
    },
    {
      heading: "Who sees your reports",
      paragraphs: [
        "Enforcement officers and supervisors of the organization responsible for the area. They see you only as a pseudonymous reference, not your name or email. Other users never see your reports.",
      ],
    },
    {
      heading: "Location",
      paragraphs: ["ParkWatch uses your location only while you use the map or create a report. It is never tracked in the background."],
    },
    {
      heading: "Closing your account",
      paragraphs: [
        "In Settings → Delete Account. Your name, profile picture, notifications and push registrations are removed at once, and your email address and password are deleted afterwards. Reports you already sent stay with the enforcement organization without your name, because they are records of enforcement decisions.",
      ],
    },
    {
      heading: "To be added before launch",
      bullets: [
        "The data controller's legal name, business ID and contact details for privacy requests",
        "The legal basis for each use of data",
        "How long reports and other records are kept",
        "International transfers (plate recognition) and the safeguards used",
        "How to request access to, correction of or a copy of your data",
      ],
    },
  ],
};

const OFFICER_HELP: InfoPage = {
  id: "officer-help",
  title: "Help & Support",
  subtitle: "How the officer app works",
  sections: [
    {
      heading: "Queue",
      paragraphs: [
        "The Queue lists the open reports you can see. Filters narrow it to unassigned, high-priority or your own reports. Accepting a report assigns it to you.",
      ],
    },
    {
      heading: "Inspection",
      bullets: [
        "Open an accepted report and start the on-site inspection at the location.",
        "Work through the checklist and take your officer photos.",
        "Choose the result yourself: issue a parking charge or record why no charge is issued. A report can also be rejected from its details. The app never decides for you.",
      ],
    },
    {
      heading: "Cases and notifications",
      paragraphs: [
        "Cases shows the reports you have handled. Notifications shows case updates inside the app. If you turn on push notifications, a supervisor's assignment also reaches your phone; the lock screen shows no case details.",
      ],
    },
    {
      heading: "Account and equipment",
      paragraphs: ["Your district and work vehicle are managed by your organization. Contact your supervisor for account or equipment issues."],
    },
  ],
};

export const INFO_PAGES: Record<InfoPageId, InfoPage> = {
  help: HELP,
  about: ABOUT,
  "privacy-data": PRIVACY_DATA,
  terms: TERMS,
  "privacy-policy": PRIVACY_POLICY,
  "officer-help": OFFICER_HELP,
};

/** Route of each page (static routes under app/user/info and app/officer/info). */
export const INFO_PAGE_ROUTE: Record<InfoPageId, string> = {
  help: "/user/info/help",
  about: "/user/info/about",
  "privacy-data": "/user/info/privacy-data",
  terms: "/user/info/terms",
  "privacy-policy": "/user/info/privacy-policy",
  "officer-help": "/officer/info/officer-help",
};
