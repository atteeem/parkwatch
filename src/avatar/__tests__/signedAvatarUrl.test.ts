import type { Result } from "../../domain";
import { AVATAR_URL_REFRESH_COOLDOWN_MS, AVATAR_URL_REFRESH_MARGIN_MS, SignedAvatarUrl } from "../signedAvatarUrl";

const TTL = 60 * 60 * 1000;
const PATH = "u1/avatar.jpg";

function setup(results: Result<string>[] = []) {
  let t = 1_000_000;
  let n = 0;
  const signCalls: string[] = [];
  const shown: (string | undefined)[] = [];
  const sign = jest.fn(async (p: string): Promise<Result<string>> => {
    signCalls.push(p);
    n++;
    return results.shift() ?? { ok: true, value: `https://signed.example/${p}?v=${n}` };
  });
  const c = new SignedAvatarUrl({ sign, ttlMs: TTL, onUrl: (u) => shown.push(u), now: () => t });
  return { c, sign, signCalls, shown, advance: (ms: number) => (t += ms) };
}

const fail: Result<string> = { ok: false, error: { code: "BACKEND_ERROR", message: "x" } };

describe("private avatar: signed URL refresh", () => {
  it("loads by signing the stored path", async () => {
    const { c, signCalls } = setup();
    await c.set(PATH);
    expect(signCalls).toEqual([PATH]);
    expect(c.currentUrl).toBe(`https://signed.example/${PATH}?v=1`);
  });

  it("an expired/broken URL triggers exactly one refresh of the SAME path, and the new URL is shown", async () => {
    const { c, signCalls, shown, advance } = setup();
    await c.set(PATH);
    const broken = c.currentUrl;
    advance(TTL + 1); // expired
    await c.handleDisplayError(broken);
    // The same failure reported again (e.g. a second Image) does not re-sign.
    await c.handleDisplayError(broken);
    expect(signCalls).toEqual([PATH, PATH]);
    expect(c.currentUrl).toBe(`https://signed.example/${PATH}?v=2`);
    expect(shown[shown.length - 1]).toBe(c.currentUrl);
  });

  it("concurrent error reports share one request", async () => {
    const { c, sign, advance } = setup();
    await c.set(PATH);
    advance(AVATAR_URL_REFRESH_COOLDOWN_MS);
    const u = c.currentUrl;
    await Promise.all([c.handleDisplayError(u), c.handleDisplayError(u), c.refresh("expiry")]);
    expect(sign).toHaveBeenCalledTimes(2);
  });

  it("repeated failures do not loop: the refreshed URL failing again within the cooldown falls back to initials", async () => {
    const { c, sign, advance } = setup();
    await c.set(PATH);
    advance(AVATAR_URL_REFRESH_COOLDOWN_MS);
    await c.handleDisplayError(c.currentUrl); // refresh #1
    const again = c.currentUrl;
    await c.handleDisplayError(again); // inside cooldown -> no request, initials
    for (let i = 0; i < 10; i++) await c.handleDisplayError(again);
    expect(sign).toHaveBeenCalledTimes(2);
    expect(c.currentUrl).toBeUndefined();
    expect(c.msUntilRefresh()).toBeNull(); // nothing scheduled while showing initials
  });

  it("a failing refresh falls back safely and is not retried in a loop", async () => {
    const { c, sign, advance } = setup([{ ok: true, value: "https://signed.example/first" }, fail, fail, fail]);
    await c.set(PATH);
    advance(AVATAR_URL_REFRESH_COOLDOWN_MS);
    await c.handleDisplayError("https://signed.example/first");
    expect(c.currentUrl).toBeUndefined();
    // Coming back to the app retries, but only after the cooldown.
    await c.ensureFresh();
    await c.ensureFresh();
    expect(sign).toHaveBeenCalledTimes(2);
    advance(AVATAR_URL_REFRESH_COOLDOWN_MS);
    await c.ensureFresh();
    expect(sign).toHaveBeenCalledTimes(3);
  });

  it("re-signs proactively before expiry; a failed proactive refresh keeps the still-valid URL", async () => {
    const { c, sign, advance } = setup([{ ok: true, value: "https://signed.example/a" }, fail, { ok: true, value: "https://signed.example/b" }]);
    await c.set(PATH);
    expect(c.msUntilRefresh()).toBe(TTL - AVATAR_URL_REFRESH_MARGIN_MS);
    await c.ensureFresh(); // not due yet
    expect(sign).toHaveBeenCalledTimes(1);
    advance(TTL - AVATAR_URL_REFRESH_MARGIN_MS);
    await c.ensureFresh();
    expect(c.currentUrl).toBe("https://signed.example/a");
    advance(AVATAR_URL_REFRESH_COOLDOWN_MS);
    await c.ensureFresh();
    expect(c.currentUrl).toBe("https://signed.example/b");
    expect(c.msUntilRefresh()).toBe(TTL - AVATAR_URL_REFRESH_MARGIN_MS);
  });

  it("stale errors and results for a replaced/removed avatar are ignored", async () => {
    const { c, sign, advance } = setup();
    await c.set(PATH);
    const old = c.currentUrl;
    await c.set("u1/new.jpg", "https://signed.example/new");
    advance(AVATAR_URL_REFRESH_COOLDOWN_MS);
    await c.handleDisplayError(old); // not the displayed URL any more
    expect(sign).toHaveBeenCalledTimes(1);
    await c.set(null);
    await c.handleDisplayError("https://signed.example/new");
    expect(sign).toHaveBeenCalledTimes(1);
    expect(c.currentUrl).toBeUndefined();
  });
});
