import { createContext, useContext } from "react";

/**
 * Lets an evidence image ask for a fresh signed URL when its current one
 * fails (most likely expired). Resolves true if a new URL is coming. The
 * local demo has no signed URLs, so the default never retries.
 */
export const EvidenceUrlContext = createContext<(failedUrl: string) => Promise<boolean>>(async () => false);

export const useEvidenceUrlRefresh = () => useContext(EvidenceUrlContext);
