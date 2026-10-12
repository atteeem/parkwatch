import * as fs from "fs";
import * as path from "path";
import { createDialClick, DIAL_CLICK_MIN_INTERVAL_MS } from "../dialClick";

describe("dial click player", () => {
  it("loads the sound once and reuses one player", () => {
    const play = jest.fn();
    const load = jest.fn(() => ({ play }));
    let t = 0;
    const click = createDialClick(load, () => t);
    click.preload();
    for (let i = 0; i < 5; i++) {
      t += 100;
      expect(click.tick()).toBe(true);
    }
    expect(load).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(5);
  });

  it("rate-limits fast spins by dropping (not queueing) clicks", () => {
    const play = jest.fn();
    let t = 1000;
    const click = createDialClick(() => ({ play }), () => t);
    // 100 minute changes within one second
    for (let i = 0; i < 100; i++) {
      click.tick();
      t += 10;
    }
    expect(play.mock.calls.length).toBeLessThanOrEqual(Math.ceil(1000 / DIAL_CLICK_MIN_INTERVAL_MS));
    expect(play.mock.calls.length).toBeGreaterThan(10);
    // nothing is replayed afterwards (no backlog)
    const before = play.mock.calls.length;
    t += 5000;
    expect(play.mock.calls.length).toBe(before);
  });

  it("audio failure (load or play) is silent and never throws", () => {
    const noLoad = createDialClick(() => {
      throw new Error("no audio module");
    });
    expect(noLoad.tick()).toBe(false);
    let t = 0;
    const play = jest.fn(() => {
      throw new Error("playback failed");
    });
    const broken = createDialClick(() => ({ play }), () => (t += 100));
    expect(() => broken.tick()).not.toThrow();
    expect(broken.tick()).toBe(false); // stops trying after a failure
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("the bundled click is a tiny original WAV; audio config adds no microphone or background audio", () => {
    const root = path.resolve(__dirname, "../../..");
    const wav = fs.readFileSync(path.join(root, "assets/sounds/dial-click.wav"));
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.length).toBeLessThan(4000);
    const app = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
    const audio = app.expo.plugins.find((p: unknown) => Array.isArray(p) && p[0] === "expo-audio");
    expect(audio?.[1]).toEqual({ microphonePermission: false, recordAudioAndroid: false, enableBackgroundPlayback: false, enableBackgroundRecording: false });
    const src = fs.readFileSync(path.join(root, "src/feedback/dialClick.ts"), "utf8");
    expect(src).toMatch(/playsInSilentMode: false/);
    expect(src).toMatch(/interruptionMode: "mixWithOthers"/);
  });
});
