// Keeps the signed URL of the private profile picture fresh.
//
// The avatar lives in the private "profile-avatars" bucket and is shown through
// a short-lived signed URL. The storage PATH is kept here so the same object can
// be re-signed:
//   * before expiry   - refresh() is scheduled REFRESH_MARGIN before expiresAt
//                       (and ensureFresh() runs when the app returns to the front)
//   * on a load error - the displayed URL failed (expired/broken): re-sign ONCE
//
// No loops: one refresh at a time, at most one error-triggered refresh per
// failed URL, and a cooldown between non-initial refreshes. When a refresh is
// not possible the picture falls back to the initials (url undefined).

import type { Result } from "../domain";

export const AVATAR_URL_REFRESH_MARGIN_MS = 5 * 60 * 1000;
export const AVATAR_URL_REFRESH_COOLDOWN_MS = 60 * 1000;

export type SignedAvatarUrlDeps = {
  sign: (path: string) => Promise<Result<string>>;
  /** Lifetime of a signed URL (SIGNED_URL_TTL_SECONDS). */
  ttlMs: number;
  /** Called whenever the URL to display changes (undefined = initials). */
  onUrl: (url: string | undefined) => void;
  now?: () => number;
};

type Reason = "load" | "expiry" | "error";

export class SignedAvatarUrl {
  private path: string | null = null;
  private url: string | undefined;
  private expiresAt = 0;
  private lastAttemptAt = Number.NEGATIVE_INFINITY;
  private erroredUrl: string | undefined;
  private inFlight: Promise<void> | null = null;
  /** Bumped on every set(): results for an older path are dropped. */
  private generation = 0;
  private readonly now: () => number;

  constructor(private readonly deps: SignedAvatarUrlDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** New avatar path (or none). Pass `url` when a fresh signed URL is already at hand. */
  set(path: string | null, url?: string): Promise<void> {
    this.generation++;
    this.path = path;
    this.erroredUrl = undefined;
    this.inFlight = null;
    this.lastAttemptAt = Number.NEGATIVE_INFINITY;
    if (path && url) {
      this.show(url);
      return Promise.resolve();
    }
    this.url = undefined;
    this.expiresAt = 0;
    this.deps.onUrl(undefined);
    return path ? this.refresh("load") : Promise.resolve();
  }

  get currentUrl(): string | undefined {
    return this.url;
  }

  /** Milliseconds until the proactive refresh is due (null = nothing to refresh). */
  msUntilRefresh(): number | null {
    if (!this.path || !this.url) return null;
    return Math.max(0, this.expiresAt - AVATAR_URL_REFRESH_MARGIN_MS - this.now());
  }

  /**
   * Re-sign if the current URL is (about to be) expired, or retry a picture
   * that fell back to the initials (cooldown applies), e.g. when the app
   * comes back to the front.
   */
  ensureFresh(): Promise<void> {
    if (this.path && !this.url) return this.refresh("expiry");
    const ms = this.msUntilRefresh();
    return ms === 0 ? this.refresh("expiry") : Promise.resolve();
  }

  /** The displayed image failed to load. Re-signs at most once per failed URL. */
  handleDisplayError(failedUrl: string | undefined): Promise<void> {
    if (!this.path || !failedUrl || failedUrl !== this.url) return Promise.resolve(); // stale event
    if (this.erroredUrl === failedUrl) return Promise.resolve();
    this.erroredUrl = failedUrl;
    return this.refresh("error");
  }

  refresh(reason: Reason = "expiry"): Promise<void> {
    if (!this.path) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    if (reason !== "load" && this.now() - this.lastAttemptAt < AVATAR_URL_REFRESH_COOLDOWN_MS) {
      // Too soon to ask again. A broken image falls back to the initials.
      if (reason === "error") this.hide();
      return Promise.resolve();
    }
    this.lastAttemptAt = this.now();
    const gen = this.generation;
    const path = this.path;
    const run = (async () => {
      let r: Result<string>;
      try {
        r = await this.deps.sign(path);
      } catch {
        r = { ok: false, error: { code: "BACKEND_ERROR", message: "BACKEND_ERROR" } };
      }
      if (gen !== this.generation) return;
      if (r.ok) this.show(r.value);
      // A proactive refresh that failed keeps the current URL (still valid for
      // the margin); a failed load or error refresh falls back to the initials.
      else if (reason !== "expiry") this.hide();
    })();
    this.inFlight = run;
    void run.finally(() => {
      if (this.inFlight === run) this.inFlight = null;
    });
    return run;
  }

  private show(url: string) {
    this.url = url;
    this.expiresAt = this.now() + this.deps.ttlMs;
    this.deps.onUrl(url);
  }

  private hide() {
    if (this.url === undefined) return;
    this.url = undefined;
    this.deps.onUrl(undefined);
  }
}
