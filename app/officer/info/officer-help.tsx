import React from "react";
import { InfoPageView } from "../../../src/components/InfoPageView";
import { INFO_PAGES } from "../../../src/content/infoPages";

// Informational page (content in src/content/infoPages.ts).
export default function OfficerHelpPage() {
  return <InfoPageView page={INFO_PAGES["officer-help"]} fallbackHref="/officer/profile" />;
}
