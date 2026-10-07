// Evidence gallery logic (pure): captions, order, paging index. Shared by the
// citizen Review screen and officer Report Details; the component only renders.

import type { CitizenEvidenceType, OfficerEvidenceType } from "../domain";

export type GalleryItem = { key: string; uri: string; caption: string };

export const CITIZEN_EVIDENCE_CAPTION: Record<CitizenEvidenceType | "ATTACHMENT", string> = {
  FRONT: "Front",
  SIDE: "Side",
  REAR: "Rear",
  ATTACHMENT: "Attachment",
};

export const OFFICER_EVIDENCE_CAPTION: Record<OfficerEvidenceType, string> = {
  VEHICLE_FRONT: "Vehicle front",
  LICENSE_PLATE: "License plate",
  PARKING_SIGN: "Parking sign",
  VEHICLE_REAR: "Vehicle rear",
};

const CITIZEN_ORDER: readonly string[] = ["FRONT", "SIDE", "REAR", "ATTACHMENT"];

/**
 * Citizen evidence as gallery pages: required Front / Side / Rear first, then
 * optional attachments (in their original order), each with its caption.
 */
export function citizenGalleryItems(evidence: readonly { id?: string; type: string; uri: string }[]): GalleryItem[] {
  return evidence
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => CITIZEN_ORDER.includes(e.type) && !!e.uri)
    .sort((a, b) => CITIZEN_ORDER.indexOf(a.e.type) - CITIZEN_ORDER.indexOf(b.e.type) || a.i - b.i)
    .map(({ e, i }) => ({
      key: e.id ?? `${e.type}-${i}`,
      uri: e.uri,
      caption: CITIZEN_EVIDENCE_CAPTION[e.type as keyof typeof CITIZEN_EVIDENCE_CAPTION],
    }));
}

export const clampIndex = (index: number, count: number): number => (count <= 0 ? 0 : Math.max(0, Math.min(count - 1, Math.round(index))));

/** Page shown for a horizontal scroll offset (snapped to the nearest page). */
export const indexFromOffset = (offsetX: number, pageWidth: number, count: number): number =>
  pageWidth > 0 ? clampIndex(offsetX / pageWidth, count) : 0;

/** "2 / 5" */
export const galleryCounter = (index: number, count: number): string => `${clampIndex(index, count) + 1} / ${Math.max(count, 0)}`;

/** Screen-reader label for the current page. */
export const galleryPageLabel = (item: GalleryItem | undefined, index: number, count: number): string =>
  item ? `${item.caption} photo, ${clampIndex(index, count) + 1} of ${count}` : "No photos";
