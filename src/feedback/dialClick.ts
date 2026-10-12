// Tactile click for the parking duration dial (T9.1). Enhancement only: the
// dial works the same when sound is muted, unavailable or fails.
//
// * One player, loaded once (lazily on the first tick, or via preload()) and
//   reused: each tick rewinds and replays it, so sounds never pile up.
// * Rate-limited: ticks closer than DIAL_CLICK_MIN_INTERVAL_MS are dropped
//   (not queued), so a fast spin can't build a backlog.
// * Mixes with other audio and follows the iOS silent switch (no sound when
//   the phone is on silent). No microphone, no background audio.

export const DIAL_CLICK_MIN_INTERVAL_MS = 35;

export type ClickPlayer = { play: () => void; release?: () => void };

export function createDialClick(load: () => ClickPlayer | null, now: () => number = Date.now, minIntervalMs = DIAL_CLICK_MIN_INTERVAL_MS) {
  let player: ClickPlayer | null | undefined; // undefined = not loaded yet, null = unavailable
  let last = Number.NEGATIVE_INFINITY;
  const ensure = () => {
    if (player !== undefined) return player;
    try {
      player = load();
    } catch {
      player = null;
    }
    return player;
  };
  return {
    preload(): void {
      ensure();
    },
    /** Called when the selected minute changes. Returns whether a click was played. */
    tick(): boolean {
      const t = now();
      if (t - last < minIntervalMs) return false;
      const p = ensure();
      if (!p) return false;
      last = t;
      try {
        p.play();
        return true;
      } catch {
        player = null; // stop trying; the dial keeps working silently
        return false;
      }
    },
    release(): void {
      try {
        player?.release?.();
      } catch {
        // ignore
      }
      player = undefined;
    },
  };
}

const CLICK_VOLUME = 0.5;

/** expo-audio player for the bundled, originally synthesized click (assets/sounds/dial-click.wav). */
function loadExpoClick(): ClickPlayer | null {
  // Lazy require: no native audio module is touched until the dial is first used.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const audio = require("expo-audio") as typeof import("expo-audio");
  void audio.setAudioModeAsync({ playsInSilentMode: false, interruptionMode: "mixWithOthers", shouldPlayInBackground: false }).catch(() => undefined);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const player = audio.createAudioPlayer(require("../../assets/sounds/dial-click.wav"));
  player.volume = CLICK_VOLUME;
  return {
    play: () => {
      void player.seekTo(0).catch(() => undefined);
      player.play();
    },
    release: () => player.remove(),
  };
}

export const dialClick = createDialClick(loadExpoClick);
