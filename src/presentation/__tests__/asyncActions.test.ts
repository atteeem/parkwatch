// The async action contract: the same guard protects synchronous (local
// demo) and asynchronous (server) actions against double taps.
import { createSubmitGuard } from "../submitGuard";
import { describeDomainError } from "../errors";
import { DomainErrorCode, Result } from "../../domain";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("submit guard with async actions", () => {
  it("returns 'pending', ignores taps while running, calls onSuccess once", async () => {
    const guard = createSubmitGuard();
    let resolve!: (r: Result<number>) => void;
    const submit = jest.fn(() => new Promise<Result<number>>((r) => (resolve = r)));
    const onSuccess = jest.fn();
    const onError = jest.fn();
    expect(guard.run(submit, { onSuccess, onError })).toBe("pending");
    expect(guard.run(submit, { onSuccess, onError })).toBe("ignored");
    expect(guard.isLocked()).toBe(true);
    resolve({ ok: true, value: 7 });
    await flush();
    expect(onSuccess).toHaveBeenCalledWith(7);
    expect(submit).toHaveBeenCalledTimes(1);
    // A finished action stays locked (no second submit after success).
    expect(guard.run(submit, { onSuccess, onError })).toBe("ignored");
  });

  it("a failure unlocks for retry", async () => {
    const guard = createSubmitGuard();
    const onError = jest.fn();
    guard.run(async () => ({ ok: false, error: { code: "NETWORK_ERROR" as const, message: "x" } }), { onSuccess: jest.fn(), onError });
    await flush();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "NETWORK_ERROR" }));
    expect(guard.isLocked()).toBe(false);
  });

  it("a rejected promise becomes a BACKEND_ERROR (never an unhandled rejection) and unlocks", async () => {
    const guard = createSubmitGuard();
    const onError = jest.fn();
    guard.run(() => Promise.reject(new Error("boom")), { onSuccess: jest.fn(), onError });
    await flush();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "BACKEND_ERROR" }));
    expect(guard.isLocked()).toBe(false);
  });

  it("synchronous actions still settle immediately", () => {
    const guard = createSubmitGuard();
    const onSuccess = jest.fn();
    expect(guard.run(() => ({ ok: true, value: 1 }), { onSuccess, onError: jest.fn() })).toBe("submitted");
    expect(onSuccess).toHaveBeenCalledWith(1);
  });
});

describe("server error messages", () => {
  it.each<[DomainErrorCode, RegExp]>([
    ["NETWORK_ERROR", /connection/i],
    ["UNAUTHENTICATED", /sign in/i],
    ["FORBIDDEN", /access/i],
    ["UPLOAD_FAILED", /photo/i],
    ["EVIDENCE_NOT_UPLOADED", /photo/i],
    ["NO_JURISDICTION", /area/i],
    ["CASE_TAKEN", /another officer/i],
    ["BACKEND_ERROR", /try again/i],
  ])("%s has a friendly message", (code, re) => {
    const m = describeDomainError({ code, message: "raw server text: relation public.reports" }).message;
    expect(m).toMatch(re);
    expect(m).not.toMatch(/relation|public\.|raw server/);
  });
});
