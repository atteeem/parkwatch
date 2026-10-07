// T8.7: the shared evidence gallery as rendered: tap a thumbnail -> full
// screen at that photo, "N / M" counter and caption, next/previous, close.
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { AccessibilityInfo, Modal, Text } from "react-native";
import { EvidenceThumbnails } from "../EvidenceGallery";
import { citizenGalleryItems } from "../../presentation/evidenceGallery";

jest.mock("@expo/vector-icons", () => ({ Ionicons: Object.assign(() => null, { glyphMap: {} }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const items = citizenGalleryItems([
  { id: "f", type: "FRONT", uri: "file:///f.jpg" },
  { id: "s", type: "SIDE", uri: "file:///s.jpg" },
  { id: "r", type: "REAR", uri: "file:///r.jpg" },
  { id: "a", type: "ATTACHMENT", uri: "file:///a.jpg" },
]);

const texts = (r: TestRenderer.ReactTestRenderer) => r.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
const byLabel = (r: TestRenderer.ReactTestRenderer, label: string) =>
  r.root.find((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === "function" && typeof n.type !== "string");
const modalOpen = (r: TestRenderer.ReactTestRenderer) => r.root.findByType(Modal).props.visible;

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
});
afterEach(() => jest.restoreAllMocks());

async function render() {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    r = TestRenderer.create(<EvidenceThumbnails items={items} thumbStyle={{ width: 60, height: 60 }} max={3} />);
  });
  return r;
}

describe("EvidenceThumbnails + EvidenceGallery", () => {
  it("shows at most `max` thumbnails, the last one says +N, and nothing is open yet", async () => {
    const r = await render();
    expect(texts(r)).toContain("+1");
    expect(modalOpen(r)).toBe(false);
  });

  it("tapping a thumbnail opens the gallery full screen at that photo with counter and caption", async () => {
    const r = await render();
    await act(async () => byLabel(r, "Side photo, open full screen").props.onPress());
    expect(modalOpen(r)).toBe(true);
    expect(texts(r)).toEqual(expect.arrayContaining(["2 / 4", "Side"]));
  });

  it("next / previous move through every photo (including the hidden attachment) and stop at the ends", async () => {
    const r = await render();
    await act(async () => byLabel(r, "Rear photo, open full screen").props.onPress());
    await act(async () => byLabel(r, "Next photo").props.onPress());
    expect(texts(r)).toEqual(expect.arrayContaining(["4 / 4", "Attachment"]));
    await act(async () => byLabel(r, "Next photo").props.onPress());
    expect(texts(r)).toContain("4 / 4");
    await act(async () => byLabel(r, "Previous photo").props.onPress());
    expect(texts(r)).toEqual(expect.arrayContaining(["3 / 4", "Rear"]));
  });

  it("close returns to the screen", async () => {
    const r = await render();
    await act(async () => byLabel(r, "Front photo, open full screen").props.onPress());
    await act(async () => byLabel(r, "Close photos").props.onPress());
    expect(modalOpen(r)).toBe(false);
  });
});
