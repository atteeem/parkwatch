// Camera guide components: vehicle-type silhouettes, officer targets, level
// indicator + sensor hook, type picker and plate scanner (rendered).
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { CameraGuideOverlay } from "../CameraGuideOverlay";
import { LevelIndicator } from "../cameraGuides/LevelIndicator";
import { VehicleTypeChip, VehicleTypePicker, VEHICLE_TYPE_PICKER_TITLE } from "../cameraGuides/VehicleTypePicker";
import { PlateScanner, plateTargetSize, PLATE_SCAN_INSTRUCTION } from "../plate/PlateScanner";
import { MotionSensor, useDeviceLevel } from "../../sensors/useDeviceLevel";
import { CAMERA_GUIDE_HINT } from "../../presentation/cameraGuides";
import { INITIAL_LEVEL, LevelState } from "../../presentation/deviceLevel";

const texts = (r: TestRenderer.ReactTestRenderer) => r.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
const byTestId = (r: TestRenderer.ReactTestRenderer, id: string) => r.root.findAll((n) => n.props.testID === id);
const METRICS = { frame: { x: 0, y: 0, width: 375, height: 812 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const withSafeArea = (el: React.ReactElement) => <SafeAreaProvider initialMetrics={METRICS}>{el}</SafeAreaProvider>;
const flush = () => act(async () => await Promise.resolve());

describe("CameraGuideOverlay", () => {
  it("draws the selected body type for the shot; a new type updates the drawing immediately", () => {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<CameraGuideOverlay kind="vehicle-side" profile="PICKUP" area={{ y: 200, height: 380 }} showLevel={false} />);
    });
    expect(byTestId(r, "guide-PICKUP-SIDE").length).toBeGreaterThan(0);
    act(() => r.update(<CameraGuideOverlay kind="vehicle-side" profile="SUV" area={{ y: 200, height: 380 }} showLevel={false} />));
    expect(byTestId(r, "guide-PICKUP-SIDE")).toHaveLength(0);
    expect(byTestId(r, "guide-SUV-SIDE").length).toBeGreaterThan(0);
    act(() => r.update(<CameraGuideOverlay kind="vehicle-rear" profile="SUV" area={{ y: 200, height: 380 }} showLevel={false} />));
    expect(byTestId(r, "guide-SUV-REAR").length).toBeGreaterThan(0);
  });

  it("officer front/rear use the generic car; plate and sign keep their own targets", () => {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<CameraGuideOverlay kind="vehicle-front" showLevel={false} />);
    });
    expect(byTestId(r, "guide-GENERIC-FRONT").length).toBeGreaterThan(0);
    act(() => r.update(<CameraGuideOverlay kind="plate" showLevel={false} />));
    expect(byTestId(r, "guide-plate").length).toBeGreaterThan(0);
    act(() => r.update(<CameraGuideOverlay kind="sign" showLevel={false} />));
    expect(byTestId(r, "guide-sign").length).toBeGreaterThan(0);
  });

  it("label + hint shown; never takes touches; hidden from screen readers", () => {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<CameraGuideOverlay kind="vehicle-rear" profile="HATCHBACK" showLevel={false} />);
    });
    const root = r.root.findAllByType(View)[0];
    expect(root.props.pointerEvents).toBe("none");
    expect(root.props.importantForAccessibility).toBe("no-hide-descendants");
    expect(texts(r)).toEqual(["REAR", CAMERA_GUIDE_HINT["vehicle-rear"]]);
  });
});

describe("LevelIndicator", () => {
  const state = (status: LevelState["status"], roll = 0): LevelState => ({ status, roll, lean: 0 });
  it("nothing while unknown; 'Level' when level; a hint when tilted or tipped", () => {
    const render = (s: LevelState) => {
      let r!: TestRenderer.ReactTestRenderer;
      act(() => {
        r = TestRenderer.create(<LevelIndicator level={s} />);
      });
      return texts(r);
    };
    expect(render(INITIAL_LEVEL)).toEqual([]);
    expect(render(state("level"))).toEqual(["Level"]);
    expect(render(state("tilted", 12))).toEqual(["Level your phone"]);
    expect(render(state("notUpright"))).toEqual(["Hold phone upright"]);
  });
});

describe("useDeviceLevel", () => {
  const Probe = ({ sensor, enabled = true, out }: { sensor: MotionSensor | null; enabled?: boolean; out: { s?: LevelState } }) => {
    out.s = useDeviceLevel(enabled, sensor);
    return null;
  };
  const fakeSensor = (available = true) => {
    const listeners: ((g: { x: number; y: number; z: number }) => void)[] = [];
    const removed = jest.fn();
    const sensor: MotionSensor = {
      isAvailableAsync: jest.fn(async () => available),
      setUpdateInterval: jest.fn(),
      addListener: jest.fn((l) => {
        listeners.push(l);
        return { remove: removed };
      }),
    };
    return { sensor, emit: (g: { x: number; y: number; z: number }) => listeners.forEach((l) => l(g)), removed };
  };

  it("subscribes while mounted, reports level/tilted, and unsubscribes on unmount", async () => {
    const f = fakeSensor();
    const out: { s?: LevelState } = {};
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<Probe sensor={f.sensor} out={out} />);
    });
    await flush();
    expect(f.sensor.addListener).toHaveBeenCalledTimes(1);
    act(() => f.emit({ x: 0, y: -1, z: 0 }));
    expect(out.s!.status).toBe("level");
    act(() => f.emit({ x: Math.sin(0.4), y: -Math.cos(0.4), z: 0 }));
    expect(out.s!.status).not.toBe("unknown");
    act(() => r.unmount());
    expect(f.removed).toHaveBeenCalledTimes(1);
  });

  it("unavailable sensor (or none at all) = no indicator, no subscription", async () => {
    const f = fakeSensor(false);
    const out: { s?: LevelState } = {};
    act(() => {
      TestRenderer.create(<Probe sensor={f.sensor} out={out} />);
    });
    await flush();
    expect(f.sensor.addListener).not.toHaveBeenCalled();
    expect(out.s).toEqual(INITIAL_LEVEL);
    const none: { s?: LevelState } = {};
    act(() => {
      TestRenderer.create(<Probe sensor={null} out={none} />);
    });
    expect(none.s).toEqual(INITIAL_LEVEL);
  });
});

describe("VehicleTypePicker", () => {
  it("offers six body types plus Not sure, and reports the choice", () => {
    const onSelect = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(withSafeArea(<VehicleTypePicker visible selected="SUV" onSelect={onSelect} onClose={jest.fn()} />));
    });
    expect(texts(r)).toContain(VEHICLE_TYPE_PICKER_TITLE);
    const radios = r.root.findAll((n) => n.props.accessibilityRole === "radio" && typeof n.props.onPress === "function");
    expect(radios.map((x) => x.props.accessibilityLabel)).toEqual(["Sedan", "SUV", "Hatchback", "Pickup", "Sport / Coupe", "Van / MPV", "Not sure"]);
    expect(radios.find((x) => x.props.accessibilityLabel === "SUV")!.props.accessibilityState).toEqual({ checked: true });
    act(() => radios.find((x) => x.props.accessibilityLabel === "Pickup")!.props.onPress());
    expect(onSelect).toHaveBeenCalledWith("PICKUP");
  });

  it("the camera chip names the type and opens the picker", () => {
    const onPress = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<VehicleTypeChip profile="SPORT" onPress={onPress} />);
    });
    const chip = r.root.find((n) => n.props.accessibilityRole === "button" && typeof n.props.onPress === "function");
    expect(chip.props.accessibilityLabel).toBe("Vehicle type: Sport / Coupe. Change");
    act(() => chip.props.onPress());
    expect(onPress).toHaveBeenCalled();
  });
});

describe("PlateScanner", () => {
  it("plate-shaped target, instruction, honest note, typing and Enter manually", () => {
    const onUse = jest.fn();
    const onManual = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(withSafeArea(<PlateScanner visible initialPlate="" onUsePlate={onUse} onEnterManually={onManual} onClose={jest.fn()} />));
    });
    const t = texts(r);
    expect(t).toContain(PLATE_SCAN_INSTRUCTION);
    expect(t.join(" ")).toMatch(/Automatic plate reading isn't available yet/);
    expect(t.join(" ")).not.toMatch(/detected|recogni/i);
    expect(byTestId(r, "plate-target").length).toBeGreaterThan(0);
    const input = r.root.find((n) => n.props.accessibilityLabel === "Licence plate" && typeof n.props.onChangeText === "function");
    act(() => input.props.onChangeText("xyz-9"));
    act(() => r.root.find((n) => n.props.accessibilityRole === "button" && texts({ root: n } as never).includes("Use this plate")).props.onPress());
    expect(onUse).toHaveBeenCalledWith("XYZ-9");
    act(() => r.root.find((n) => n.props.accessibilityRole === "button" && texts({ root: n } as never).includes("Enter manually")).props.onPress());
    expect(onManual).toHaveBeenCalled();
  });

  it("the target is wide like a registration plate and fits small phones", () => {
    for (const w of [320, 375, 430]) {
      const s = plateTargetSize(w);
      expect(s.width).toBeLessThanOrEqual(w - 48);
      expect(s.width / s.height).toBeGreaterThan(4.4);
    }
  });
});
