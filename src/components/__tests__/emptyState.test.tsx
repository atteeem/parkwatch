// T8.6: EmptyState / EmptyFromCopy rendering and AnimatedPressable behaviour
// (accessibility, CTA wiring, disabled state, Reduce Motion).
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { AccessibilityInfo, Text } from "react-native";
import { EmptyFromCopy, EmptyState } from "../EmptyState";
import { AnimatedPressable } from "../motion/AnimatedPressable";
import { HOME_LATEST_EMPTY, TRANSACTION_HISTORY_EMPTY } from "../../presentation/emptyStates";

jest.mock("@expo/vector-icons", () => ({ Ionicons: Object.assign(() => null, { glyphMap: {} }) }));

const texts = (r: TestRenderer.ReactTestRenderer) => r.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
const buttons = (r: TestRenderer.ReactTestRenderer) =>
  r.root.findAll((n) => n.props.accessibilityRole === "button" && typeof n.props.onPress === "function" && typeof n.type !== "string");

async function render(el: React.ReactElement) {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    r = TestRenderer.create(el);
  });
  return r;
}

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
});
afterEach(() => jest.restoreAllMocks());

describe("EmptyState", () => {
  it("renders title and body as one accessible summary", async () => {
    const r = await render(<EmptyState icon="map-outline" title="Nothing here" body="Details." />);
    expect(texts(r)).toEqual(expect.arrayContaining(["Nothing here", "Details."]));
    const summary = r.root.find((n) => n.props.accessibilityRole === "summary");
    expect(summary.props.accessibilityLabel).toBe("Nothing here. Details.");
  });

  it("shows a CTA only when one is given, and pressing it calls the handler", async () => {
    const none = await render(<EmptyState icon="map-outline" title="T" />);
    expect(buttons(none)).toHaveLength(0);

    const onPress = jest.fn();
    const r = await render(<EmptyState icon="map-outline" title="T" cta={{ label: "Do it", onPress }} />);
    expect(texts(r)).toContain("Do it");
    const btn = buttons(r)[0];
    await act(async () => btn.props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe("EmptyFromCopy", () => {
  it("passes the copy's action kind to onAction", async () => {
    const onAction = jest.fn();
    const r = await render(<EmptyFromCopy copy={HOME_LATEST_EMPTY} onAction={onAction} />);
    expect(texts(r)).toEqual(expect.arrayContaining(["No reports yet", "Create first report"]));
    await act(async () => buttons(r)[0].props.onPress());
    expect(onAction).toHaveBeenCalledWith("createReport");
  });

  it("copy without an action never renders a button, even with onAction", async () => {
    const r = await render(<EmptyFromCopy copy={TRANSACTION_HISTORY_EMPTY} onAction={jest.fn()} />);
    expect(buttons(r)).toHaveLength(0);
  });

  it("copy with an action but no handler renders no dead button", async () => {
    const r = await render(<EmptyFromCopy copy={HOME_LATEST_EMPTY} />);
    expect(buttons(r)).toHaveLength(0);
  });
});

describe("AnimatedPressable", () => {
  it("keeps the caller's accessibility props and onPress", async () => {
    const onPress = jest.fn();
    const r = await render(
      <AnimatedPressable accessibilityRole="button" accessibilityLabel="Open" onPress={onPress}>
        <Text>Open</Text>
      </AnimatedPressable>
    );
    const node = r.root.find((n) => n.props.accessibilityLabel === "Open" && typeof n.props.onPress === "function");
    expect(node.props.accessibilityRole).toBe("button");
    await act(async () => node.props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("passes disabled through (a disabled button is not pressable)", async () => {
    const r = await render(
      <AnimatedPressable accessibilityLabel="Off" disabled onPress={jest.fn()}>
        <Text>Off</Text>
      </AnimatedPressable>
    );
    const node = r.root.find((n) => n.props.accessibilityLabel === "Off" && n.props.disabled !== undefined);
    expect(node.props.disabled).toBe(true);
  });
});
