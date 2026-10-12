// T9.1 parking sheet components rendered (react-test-renderer).
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text } from "react-native";
import { CircularDurationPicker } from "../parking/CircularDurationPicker";
import { VehiclePicker } from "../parking/VehiclePicker";
import { ParkingConfirmation } from "../parking/ParkingConfirmation";
import { ActiveParkingSummary, EndParking } from "../parking/ActiveParkingSheet";
import { AreaPicker } from "../parking/AreaSteps";
import { sheetSnap } from "../parking/ParkingSheet";
import { DEMO_PARKING_ZONES } from "../../domain";
import { ActiveParkingView, parkingAreaRows } from "../../presentation/parkingViews";

const texts = (r: TestRenderer.ReactTestRenderer) => r.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
const NOW = new Date(2026, 9, 12, 14, 31);

describe("CircularDurationPicker", () => {
  it("is one adjustable element whose increment/decrement change the duration", () => {
    const onChange = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<CircularDurationPicker value={60} onChange={onChange} accessibilityValueText="1 hour, ends at 15:31" />);
    });
    const dial = r.root.find((n) => n.props.accessibilityRole === "adjustable");
    expect(dial.props.accessibilityLabel).toBe("Parking duration");
    expect(dial.props.accessibilityValue).toEqual({ text: "1 hour, ends at 15:31" });
    act(() => dial.props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } }));
    expect(onChange).toHaveBeenLastCalledWith(61);
    act(() => dial.props.onAccessibilityAction({ nativeEvent: { actionName: "decrement" } }));
    expect(onChange).toHaveBeenLastCalledWith(59);
  });

  it("cannot decrement below 1 minute", () => {
    const onChange = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<CircularDurationPicker value={1} onChange={onChange} onTick={jest.fn()} accessibilityValueText="x" />);
    });
    act(() => r.root.find((n) => n.props.accessibilityRole === "adjustable").props.onAccessibilityAction({ nativeEvent: { actionName: "decrement" } }));
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it("dragging works from the first move: the origin comes from the touch start (no async measuring)", () => {
    const onChange = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<CircularDurationPicker value={60} size={260} onChange={onChange} onTick={jest.fn()} accessibilityValueText="x" />);
    });
    const dial = r.root.find((n) => n.props.accessibilityRole === "adjustable");
    // Dial at page (100, 200); centre (230, 330); ring radius 120.
    const at = (deg: number, t: number) => {
      const x = 230 + 120 * Math.sin((deg * Math.PI) / 180);
      const y = 330 - 120 * Math.cos((deg * Math.PI) / 180);
      const touch = { touchActive: true, startPageX: 230, startPageY: 210, startTimeStamp: 0, currentPageX: x, currentPageY: y, currentTimeStamp: t, previousPageX: x, previousPageY: y, previousTimeStamp: t };
      return {
        nativeEvent: { pageX: x, pageY: y, locationX: x - 100, locationY: y - 200, touches: [], changedTouches: [], timestamp: t },
        touchHistory: { numberActiveTouches: 1, indexOfSingleActiveTouch: 0, mostRecentTimeStamp: t, touchBank: [touch] },
      };
    };
    act(() => dial.props.onResponderGrant(at(0, 1)));
    act(() => dial.props.onResponderMove(at(30, 2)));
    expect(onChange).toHaveBeenLastCalledWith(65);
    act(() => dial.props.onResponderMove(at(90, 3)));
    expect(onChange).toHaveBeenLastCalledWith(75);
    act(() => dial.props.onResponderRelease(at(90, 4)));
  });

  it("respects the range at its ends", () => {
    const onChange = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<CircularDurationPicker value={120} range={{ min: 5, max: 120 }} onChange={onChange} accessibilityValueText="x" />);
    });
    const dial = r.root.find((n) => n.props.accessibilityRole === "adjustable");
    act(() => dial.props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } }));
    expect(onChange).toHaveBeenLastCalledWith(120);
  });
});

describe("sheet steps", () => {
  it("area list rows are labelled buttons and select the area", () => {
    const onSelect = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<AreaPicker rows={parkingAreaRows(undefined)} query="" onSelect={onSelect} />);
    });
    const row = r.root.find((n) => n.props.accessibilityRole === "button" && /^Area C4, Esplanadi, €3\.00 \/ h$/.test(n.props.accessibilityLabel ?? ""));
    act(() => row.props.onPress());
    expect(onSelect).toHaveBeenCalledWith("C4");
    expect(texts(r)).toContain("Select area");
  });

  it("vehicle picker with no vehicles: Add vehicle is offered and Continue is disabled", () => {
    const onAdd = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<VehiclePicker vehicles={[]} onSelect={jest.fn()} onAdd={onAdd} onContinue={jest.fn()} onBack={jest.fn()} />);
    });
    act(() => r.root.find((n) => n.props.accessibilityLabel === "Add vehicle" && n.props.onPress).props.onPress());
    expect(onAdd).toHaveBeenCalled();
    const cta = r.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityState?.disabled !== undefined && texts(r).includes("Continue"));
    expect(cta.props.accessibilityState).toEqual({ disabled: true });
  });

  it("vehicle rows are radios with the plate first", () => {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(
        <VehiclePicker
          vehicles={[{ id: "v1", plate: "ABC-123", title: "Volvo XC60", isDefault: true }]}
          selectedId="v1"
          onSelect={jest.fn()}
          onAdd={jest.fn()}
          onContinue={jest.fn()}
          onBack={jest.fn()}
        />
      );
    });
    const radio = r.root.find((n) => n.props.accessibilityRole === "radio");
    expect(radio.props.accessibilityState).toEqual({ checked: true });
    expect(radio.props.accessibilityLabel).toBe("ABC-123, Volvo XC60");
  });

  it("review: area, vehicle, times, estimate and the demo disclosure; Start parking (no Pay)", () => {
    const onStart = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(
        <ParkingConfirmation
          zone={DEMO_PARKING_ZONES.find((z) => z.id === "C4")!}
          vehicle={{ id: "v1", plate: "ABC-123", title: "Volvo XC60", isDefault: true }}
          minutes={75}
          now={NOW}
          onStart={onStart}
          onBack={jest.fn()}
        />
      );
    });
    const t = texts(r);
    for (const s of ["C4 · Esplanadi", "ABC-123 · Volvo XC60", "Now · 14:31", "15:46", "1 h 15 min", "€3.00 / h", "Estimated demo cost", "€3.75", "Demo parking"]) expect(t).toContain(s);
    expect(t.join(" ")).toMatch(/No parking operator is contacted and no payment is taken\./);
    expect(t.join(" ")).not.toMatch(/\bPay\b/);
    act(() => r.root.find((n) => n.props.accessibilityRole === "button" && n.props.onPress && texts(r).includes("Start parking") && n.findAllByType(Text).some((x) => x.props.children === "Start parking")).props.onPress());
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  const view: ActiveParkingView = {
    id: "p",
    plate: "ABC-123",
    zone: "Zone A1",
    zoneId: "A1",
    areaName: "Railway Square",
    location: "Kaivokatu 12, Helsinki",
    startText: "14:00",
    endText: "15:00",
    remainingMs: 29 * 60_000,
    remainingText: "29:00",
    elapsedText: "31 min",
    expired: false,
    progress: 0.52,
    currentCostText: "€1.03",
  };

  it("active session: remaining time, progress, current demo cost, Extend and End", () => {
    const onExtend = jest.fn();
    const onEnd = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<ActiveParkingSummary view={view} onExtend={onExtend} onEnd={onEnd} justStarted />);
    });
    const t = texts(r);
    for (const s of ["Parking started", "Active parking", "ABC-123", "Railway Square", "29:00", "Current demo cost", "€1.03"]) expect(t).toContain(s);
    expect(r.root.find((n) => n.props.accessibilityRole === "progressbar").props.accessibilityValue).toEqual({ min: 0, max: 100, now: 52 });
    act(() => r.root.find((n) => n.props.accessibilityLabel === "Extend parking" && n.props.onPress).props.onPress());
    act(() => r.root.find((n) => n.props.accessibilityLabel === "End parking" && n.props.onPress).props.onPress());
    expect(onExtend).toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalled();
  });

  it("expired session says the planned time has ended", () => {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<ActiveParkingSummary view={{ ...view, expired: true, remainingMs: 0, remainingText: "00:00" }} onExtend={jest.fn()} onEnd={jest.fn()} />);
    });
    expect(texts(r)).toContain("Time is up");
  });

  it("end confirmation shows time parked and final demo cost", () => {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<EndParking view={view} onConfirm={jest.fn()} onBack={jest.fn()} />);
    });
    const t = texts(r);
    for (const s of ["End parking?", "A1 · Railway Square", "31 min", "Final demo cost", "€1.03", "Keep parking"]) expect(t).toContain(s);
  });
});

describe("bottom sheet drag", () => {
  it("snaps by distance or velocity, otherwise stays", () => {
    expect(sheetSnap(true, 80, 0)).toBe(false);
    expect(sheetSnap(true, 10, 0.9)).toBe(false);
    expect(sheetSnap(false, -80, 0)).toBe(true);
    expect(sheetSnap(false, -10, -0.9)).toBe(true);
    expect(sheetSnap(true, 20, 0.1)).toBe(true);
    expect(sheetSnap(false, 20, 0.1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tactile click: one per newly reached minute while dragging.
const dragEvent = (deg: number, t: number) => {
  const x = 230 + 120 * Math.sin((deg * Math.PI) / 180);
  const y = 330 - 120 * Math.cos((deg * Math.PI) / 180);
  const touch = { touchActive: true, startPageX: 230, startPageY: 210, startTimeStamp: 0, currentPageX: x, currentPageY: y, currentTimeStamp: t, previousPageX: x, previousPageY: y, previousTimeStamp: t };
  return {
    nativeEvent: { pageX: x, pageY: y, locationX: x - 100, locationY: y - 200, touches: [], changedTouches: [], timestamp: t },
    touchHistory: { numberActiveTouches: 1, indexOfSingleActiveTouch: 0, mostRecentTimeStamp: t, touchBank: [touch] },
  };
};

describe("dial click on minute change", () => {
  const setup = (onTick: () => void) => {
    const onChange = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<CircularDurationPicker value={10} size={260} onChange={onChange} onTick={onTick} accessibilityValueText="x" />);
    });
    return { dial: r.root.find((n) => n.props.accessibilityRole === "adjustable"), onChange };
  };

  it("clicks once per new minute, not for finger movement within the same minute, and also backwards", () => {
    const onTick = jest.fn();
    const { dial, onChange } = setup(onTick);
    act(() => dial.props.onResponderGrant(dragEvent(0, 1)));
    act(() => dial.props.onResponderMove(dragEvent(1, 2))); // 10.17 -> still 10
    act(() => dial.props.onResponderMove(dragEvent(2, 3))); // 10.33 -> still 10
    expect(onTick).not.toHaveBeenCalled();
    act(() => dial.props.onResponderMove(dragEvent(6, 4))); // 11
    act(() => dial.props.onResponderMove(dragEvent(12, 5))); // 12
    expect(onTick).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([11, 12]);
    act(() => dial.props.onResponderMove(dragEvent(6, 6))); // back to 11
    expect(onTick).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenLastCalledWith(11);
  });

  it("a failing sound never breaks the dial", () => {
    const { dial, onChange } = setup(() => {
      throw new Error("audio unavailable");
    });
    act(() => dial.props.onResponderGrant(dragEvent(0, 1)));
    expect(() => act(() => dial.props.onResponderMove(dragEvent(6, 2)))).not.toThrow();
    act(() => dial.props.onResponderMove(dragEvent(12, 3)));
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([11, 12]);
  });
});
