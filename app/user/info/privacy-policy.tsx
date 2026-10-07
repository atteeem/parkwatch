import React from "react";
import { InfoPageView } from "../../../src/components/InfoPageView";
import { INFO_PAGES } from "../../../src/content/infoPages";

// Informational page (content in src/content/infoPages.ts).
export default function PrivacyPolicyPage() {
  return <InfoPageView page={INFO_PAGES["privacy-policy"]} fallbackHref="/user/profile" />;
}
