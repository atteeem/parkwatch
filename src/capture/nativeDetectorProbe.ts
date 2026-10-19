// T9.4 SPIKE - crash-safe check that the on-device detector's native code is
// really in this app binary, BEFORE any of its JavaScript is evaluated.
//
// Why: react-native-nitro-modules throws while its module is being evaluated
// when the native "NitroModules" TurboModule is missing. Metro reports an
// error thrown by a top-level require() as FATAL (red screen) even inside a
// try/catch, so a "lazy require" is not a safe fallback. This probe only
// uses calls that never throw for a missing module (TurboModuleRegistry.get)
// and reports an exact, readable reason instead.

export type DetectorStatus =
  | { ok: true; nitroVersion: string }
  | {
      ok: false;
      reason: "EXPO_GO" | "NITRO_NOT_IN_BINARY" | "NITRO_INSTALL_FAILED" | "NITRO_VERSION_MISMATCH" | "TFLITE_NOT_IN_BINARY" | "PROBE_ERROR" | "JS_LOAD_FAILED" | "MODEL_LOAD_FAILED";
      detail?: string;
    };

type NitroProxyLike = { version?: string; hasHybridObject?: (name: string) => boolean; getAllHybridObjectNames?: () => string[] };
type TurboModuleLike = { install?: () => string | undefined | null };

export type ProbeEnv = {
  executionEnvironment?: string;
  getTurboModule: (name: string) => TurboModuleLike | null | undefined;
  getProxy: () => NitroProxyLike | undefined;
  jsNitroVersion: string;
};

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

export function probeNativeDetector(env: ProbeEnv): DetectorStatus {
  try {
    if (env.executionEnvironment === "storeClient") return { ok: false, reason: "EXPO_GO", detail: "Expo Go has no custom native modules; use the ParkWatch development build." };
    let proxy = env.getProxy();
    if (!proxy) {
      const tm = env.getTurboModule("NitroModules");
      if (!tm || typeof tm.install !== "function") {
        return { ok: false, reason: "NITRO_NOT_IN_BINARY", detail: "TurboModuleRegistry.get('NitroModules') returned null in this app binary." };
      }
      const err = tm.install();
      if (err) return { ok: false, reason: "NITRO_INSTALL_FAILED", detail: String(err).slice(0, 300) };
      proxy = env.getProxy();
      if (!proxy) return { ok: false, reason: "NITRO_INSTALL_FAILED", detail: "install() succeeded but global.NitroModulesProxy is missing." };
    }
    if (proxy.version !== env.jsNitroVersion) {
      return { ok: false, reason: "NITRO_VERSION_MISMATCH", detail: `native ${proxy.version ?? "?"} vs JS ${env.jsNitroVersion}` };
    }
    const has = (n: string) => typeof proxy!.hasHybridObject === "function" && proxy!.hasHybridObject(n);
    if (!has("TfliteModule") || !has("AssetLoader")) {
      const names = typeof proxy.getAllHybridObjectNames === "function" ? proxy.getAllHybridObjectNames().join(", ") : "?";
      return { ok: false, reason: "TFLITE_NOT_IN_BINARY", detail: `registered hybrid objects: ${names || "(none)"}` };
    }
    return { ok: true, nitroVersion: proxy.version ?? env.jsNitroVersion };
  } catch (e) {
    return { ok: false, reason: "PROBE_ERROR", detail: msg(e) };
  }
}

type ErrorUtilsLike = { getGlobalHandler?: () => unknown; setGlobalHandler?: (h: (e: unknown, isFatal?: boolean) => void) => void };

/**
 * Evaluate a module that may throw during evaluation WITHOUT a red screen:
 * Metro routes such errors to ErrorUtils.reportFatalError (bypassing
 * try/catch), so the global handler is swapped while it runs.
 */
export function guardedRequire<T>(load: () => T, errorUtils: ErrorUtilsLike | undefined): { value: T } | { error: string } {
  const prev = errorUtils?.getGlobalHandler?.();
  let reported: unknown = undefined;
  errorUtils?.setGlobalHandler?.((e) => {
    reported = e ?? "unknown error";
  });
  try {
    const value = load();
    if (reported !== undefined) return { error: msg(reported) };
    if (value == null) return { error: "module evaluated to nothing" };
    return { value };
  } catch (e) {
    return { error: msg(e) };
  } finally {
    if (prev && errorUtils?.setGlobalHandler) errorUtils.setGlobalHandler(prev as (e: unknown, isFatal?: boolean) => void);
  }
}

export const DETECTOR_UNAVAILABLE_COPY = "Vehicle detector unavailable";
