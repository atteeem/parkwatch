import React from "react";
import { InfoPageView } from "../../src/components/InfoPageView";
import { INFO_PAGES } from "../../src/content/infoPages";

// Public (no sign-in needed): linked from sign-up. Content in src/content/infoPages.ts.
export default function PublicTermsPage() {
  return <InfoPageView page={INFO_PAGES["terms"]} fallbackHref="/" />;
}
