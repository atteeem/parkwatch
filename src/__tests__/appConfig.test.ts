// Guards the native permission surface: only camera, foreground location and
// the photo library. No microphone, no background location.

import appJson from "../../app.json";

const expo = appJson.expo as any;
const plugin = (name: string) => expo.plugins.find((p: unknown) => Array.isArray(p) && p[0] === name)?.[1];

describe("native permissions", () => {
  it("Android requests only camera and foreground location, and blocks the rest", () => {
    expect([...expo.android.permissions].sort()).toEqual(["ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION", "CAMERA"]);
    for (const p of ["RECORD_AUDIO", "ACCESS_BACKGROUND_LOCATION", "FOREGROUND_SERVICE_LOCATION", "READ_EXTERNAL_STORAGE", "WRITE_EXTERNAL_STORAGE", "SYSTEM_ALERT_WINDOW"]) {
      expect(expo.android.blockedPermissions).toContain(`android.permission.${p}`);
    }
  });

  it("location is foreground-only on both platforms", () => {
    expect(plugin("expo-location")).toMatchObject({
      isAndroidBackgroundLocationEnabled: false,
      isIosBackgroundLocationEnabled: false,
      isAndroidForegroundServiceEnabled: false,
      locationAlwaysAndWhenInUsePermission: false,
      locationAlwaysPermission: false,
      motionUsagePermission: false,
      isAndroidMotionActivityEnabled: false,
    });
    expect(expo.ios.infoPlist.UIBackgroundModes).toBeUndefined();
  });

  it("no microphone permission (photos only)", () => {
    expect(plugin("expo-camera")).toMatchObject({ microphonePermission: false, recordAudioAndroid: false });
    expect(plugin("expo-image-picker")).toMatchObject({ microphonePermission: false });
    expect(JSON.stringify(expo)).not.toMatch(/NSMicrophoneUsageDescription/);
  });
});
