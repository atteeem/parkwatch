import React from "react";
import { InfoPageView } from "../../../src/components/InfoPageView";
import { INFO_PAGES } from "../../../src/content/infoPages";

// Informational page (content in src/content/infoPages.ts).
export default function AboutPage() {
  return <InfoPageView page={INFO_PAGES["about"]} fallbackHref="/user/profile" />;
}
