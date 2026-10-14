/**
 * @jest-environment node
 */
// push-dispatch: content privacy, Expo transport parsing and error mapping,
// dispatch idempotency/retry bookkeeping and the HTTP handler. Uses a
// deterministic FAKE transport and a fake store only - no real push is sent.
import * as fs from "fs";
import * as path from "path";
import { EXPO_PUSH_TOKEN, parsePushData, PUSH_CHANNEL_ID, PUSH_TYPES, pushContentFor, ClaimedNotification } from "../pushContent.ts";
import { createExpoPushTransport, DeviceTicket, EXPO_RECEIPTS_URL, EXPO_SEND_URL, ExpoMessage, PushTransport, Receipt, RequestFailure } from "../expoPushTransport.ts";
import { ClaimedPush, PushStore, runPushDispatch, TicketResult } from "../pushDispatch.ts";
import { DISPATCH_SECRET_HEADER, handlePushDispatch, sameSecret } from "../pushDispatchHandler.ts";

const CASE = "6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const TOK = (s: string) => `ExponentPushToken[${s}xxxxxxxxxxxx]`;
const notif = (over: Partial<ClaimedNotification>): ClaimedNotification => ({
  id: "n-1",
  type: "REPORT_VERIFIED",
  recipient_role: "CITIZEN",
  amount_cents: 500,
  report_number: 100023,
  case_id: CASE,
  ...over,
});

// ---------------------------------------------------------------------------
// Fakes

class FakeTransport implements PushTransport {
  sent: ExpoMessage[][] = [];
  receiptCalls: string[][] = [];
  /** Per call: either a request failure, or a ticket per message decided by the token. */
  failNext: RequestFailure[] = [];
  ticketFor: (m: ExpoMessage) => DeviceTicket = (m) => ({ status: "ok", ticketId: `t-${m.to.slice(18, 22)}-${this.sent.length}` });
  receipts: Record<string, Receipt> = {};
  async send(messages: ExpoMessage[]) {
    this.sent.push(messages);
    const f = this.failNext.shift();
    if (f) return f;
    return { ok: true as const, tickets: messages.map((m) => this.ticketFor(m)) };
  }
  async getReceipts(ids: string[]) {
    this.receiptCalls.push(ids);
    return { ok: true as const, receipts: Object.fromEntries(ids.filter((i) => this.receipts[i]).map((i) => [i, this.receipts[i]])) };
  }
}

/** A tiny in-memory stand-in for the push_* RPCs (status rules mirror the migration). */
class FakeStore implements PushStore {
  rows: { outbox_id: string; notification: ClaimedNotification; devices: { device_id: string; token: string; platform: string; enabled: boolean }[]; status: string; attempts: number; leased: boolean }[] = [];
  tickets: { outbox_id: string; device_id: string; ticket?: string; error?: string }[] = [];
  recorded: { outboxId: string; tickets: TicketResult[]; requestError: string | null }[] = [];
  receiptsRecorded: { ticket_id: string; status: string; error?: string }[] = [];
  pending: string[] = [];
  add(id: string, n: ClaimedNotification, tokens: string[]) {
    this.rows.push({ outbox_id: id, notification: n, devices: tokens.map((t, i) => ({ device_id: `${id}-d${i}`, token: t, platform: "ios", enabled: true })), status: "PENDING", attempts: 0, leased: false });
  }
  async claim(limit: number): Promise<ClaimedPush[]> {
    const due = this.rows.filter((r) => r.status === "PENDING" && !r.leased).slice(0, limit);
    for (const r of due) {
      r.leased = true;
      r.attempts += 1;
    }
    return due.map((r) => ({
      outbox_id: r.outbox_id,
      attempt: r.attempts,
      notification: r.notification,
      devices: r.devices.filter((d) => d.enabled && !this.tickets.some((t) => t.outbox_id === r.outbox_id && t.device_id === d.device_id)).map(({ device_id, token, platform }) => ({ device_id, token, platform })),
    }));
  }
  async recordResult(outboxId: string, tickets: TicketResult[], requestError: string | null) {
    this.recorded.push({ outboxId, tickets, requestError });
    const r = this.rows.find((x) => x.outbox_id === outboxId)!;
    for (const t of tickets) {
      if (t.status === "error" && t.error === "MessageRateExceeded") continue;
      this.tickets.push({ outbox_id: outboxId, device_id: t.device_id, ...(t.status === "ok" ? { ticket: t.ticket_id } : { error: t.error }) });
      if (t.status === "error" && (t.error === "DeviceNotRegistered" || t.error === "InvalidToken")) r.devices.find((d) => d.device_id === t.device_id)!.enabled = false;
    }
    const remaining = r.devices.filter((d) => d.enabled && !this.tickets.some((t) => t.outbox_id === outboxId && t.device_id === d.device_id)).length;
    const delivered = this.tickets.some((t) => t.outbox_id === outboxId && t.ticket);
    r.leased = false;
    if (!requestError && remaining === 0) r.status = delivered ? "SENT" : this.tickets.some((t) => t.outbox_id === outboxId) ? "FAILED" : "NO_DEVICE";
    else if (["UNAUTHORIZED", "BAD_REQUEST"].includes(requestError ?? "") || r.attempts >= 5) r.status = "FAILED";
    else r.status = "PENDING";
    return { status: r.status };
  }
  async pendingReceipts() {
    return this.pending;
  }
  async recordReceipts(receipts: { ticket_id: string; status: "ok" | "error"; error?: string }[]) {
    this.receiptsRecorded.push(...receipts);
    return { recorded: receipts.length };
  }
}

// ---------------------------------------------------------------------------
// Content

describe("push content (lock-screen privacy)", () => {
  it("only the three pushable types produce content, for the right recipient role", () => {
    expect(PUSH_TYPES).toEqual(["REPORT_VERIFIED", "REPORT_REJECTED", "CASE_ASSIGNED"]);
    for (const type of ["REPORT_UNDER_REVIEW", "CASE_ACCEPTED", "PARKING_CHARGE_ISSUED", "CASE_CLOSED_WITHOUT_CHARGE", "CASE_ASSIGNMENT_REMOVED", "WITHDRAWAL_REQUESTED", "SYSTEM"]) {
      expect(pushContentFor(notif({ type }))).toBeNull();
    }
    expect(pushContentFor(notif({ type: "REPORT_VERIFIED", recipient_role: "OFFICER" }))).toBeNull();
    expect(pushContentFor(notif({ type: "CASE_ASSIGNED", recipient_role: "CITIZEN" }))).toBeNull();
  });

  it("matches the SQL eligibility list exactly", () => {
    const sql = fs.readFileSync(path.join(__dirname, "../../../migrations/20261014000002_t92_push_notifications.sql"), "utf8");
    const m = sql.match(/return p_type::text in \(([^)]*)\)/);
    expect(m && m[1].split(",").map((s) => s.trim().replace(/'/g, ""))).toEqual([...PUSH_TYPES]);
  });

  it("verified: generic wording, mentions the €5 reward only when it was credited", () => {
    const withReward = pushContentFor(notif({}))!;
    expect(withReward.title).toBe("Report verified");
    expect(withReward.body).toBe("Your report was verified. €5.00 reward is now available.");
    expect(pushContentFor(notif({ amount_cents: null }))!.body).toBe("Your report was verified.");
    expect(withReward.data).toEqual({ v: 1, notificationId: "n-1", type: "REPORT_VERIFIED", role: "CITIZEN", reportId: "100023" });
  });

  it("rejected: non-accusatory wording", () => {
    const c = pushContentFor(notif({ type: "REPORT_REJECTED", amount_cents: null }))!;
    expect(c.title).toBe("Report rejected");
    expect(c.body).not.toMatch(/false|fake|abuse|violation|wrong|fraud|ban/i);
  });

  it("officer assignment: generic, no plate, address, citizen or report details; deep link to the case", () => {
    const c = pushContentFor(notif({ type: "CASE_ASSIGNED", recipient_role: "OFFICER", amount_cents: null }))!;
    expect(c.title).toBe("New case assigned");
    expect(c.body).toBe("Open ParkWatch to review the case.");
    expect(c.priority).toBe("high");
    expect(c.data).toEqual({ v: 1, notificationId: "n-1", type: "CASE_ASSIGNED", role: "OFFICER", caseId: CASE });
  });

  it("no push text or payload can carry evidence URLs, storage paths, identities, locations or plates", () => {
    for (const n of [notif({}), notif({ type: "REPORT_REJECTED" }), notif({ type: "CASE_ASSIGNED", recipient_role: "OFFICER" })]) {
      const s = JSON.stringify(pushContentFor(n));
      expect(s).not.toMatch(/https?:|storage|evidence|\.jpg|token=|latitude|longitude|street|plate|@|C-[0-9A-F]{8}/i);
      expect(Object.keys(pushContentFor(n)!.data).sort()).toEqual(
        n.type === "CASE_ASSIGNED" ? ["caseId", "notificationId", "role", "type", "v"] : ["notificationId", "reportId", "role", "type", "v"]
      );
    }
  });

  it("parsePushData accepts only the v1 shapes with well-formed ids", () => {
    expect(parsePushData(pushContentFor(notif({}))!.data)).toEqual({ v: 1, notificationId: "n-1", type: "REPORT_VERIFIED", role: "CITIZEN", reportId: "100023" });
    expect(parsePushData({ v: 1, notificationId: "x", type: "CASE_ASSIGNED", role: "OFFICER", caseId: CASE })).not.toBeNull();
    for (const bad of [null, "x", {}, { v: 2 }, { v: 1, notificationId: "x", type: "CASE_ASSIGNED", role: "OFFICER", caseId: "../../etc" },
      { v: 1, notificationId: "x", type: "REPORT_VERIFIED", role: "CITIZEN", reportId: "12a" }, { v: 1, notificationId: "x", type: "REPORT_VERIFIED", role: "OFFICER", reportId: "1" },
      { v: 1, notificationId: "x", type: "SYSTEM", role: "CITIZEN", reportId: "1" }]) {
      expect(parsePushData(bad)).toBeNull();
    }
  });

  it("token pattern matches the database check", () => {
    expect(EXPO_PUSH_TOKEN.test(TOK("abc"))).toBe(true);
    expect(EXPO_PUSH_TOKEN.test("ExpoPushToken[abcdefghij]")).toBe(true);
    expect(EXPO_PUSH_TOKEN.test("ExponentPushToken[]")).toBe(false);
    expect(EXPO_PUSH_TOKEN.test("https://evil/ExponentPushToken[abcdefghij]")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Expo transport (fake fetch)

describe("Expo transport", () => {
  const msg = (to: string): ExpoMessage => ({ to, title: "t", body: "b", data: {}, sound: "default", priority: "default", ttl: 60, channelId: PUSH_CHANNEL_ID });
  const fakeFetch = (status: number, body: unknown, calls: { url: string; init: { headers: Record<string, string>; body: string } }[] = []) =>
    jest.fn(async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
      calls.push({ url, init });
      return { status, json: async () => body };
    });

  it("maps per-message tickets in order; DeviceNotRegistered is a device error", async () => {
    const calls: { url: string; init: { headers: Record<string, string>; body: string } }[] = [];
    const t = createExpoPushTransport({ fetch: fakeFetch(200, { data: [{ status: "ok", id: "abc-1" }, { status: "error", message: "\"ExponentPushToken[x]\" is not a registered push notification recipient", details: { error: "DeviceNotRegistered" } }] }, calls) });
    const res = await t.send([msg(TOK("a")), msg(TOK("b"))]);
    expect(res).toEqual({ ok: true, tickets: [{ status: "ok", ticketId: "abc-1" }, { status: "error", error: "DeviceNotRegistered" }] });
    expect(calls[0].url).toBe(EXPO_SEND_URL);
    expect(calls[0].init.headers.Authorization).toBeUndefined();
    expect(JSON.parse(calls[0].init.body)).toHaveLength(2);
  });

  it("sends the optional access token as a bearer header", async () => {
    const calls: { url: string; init: { headers: Record<string, string>; body: string } }[] = [];
    const t = createExpoPushTransport({ fetch: fakeFetch(200, { data: [{ status: "ok", id: "x" }] }, calls), accessToken: "expo-access" });
    await t.send([msg(TOK("a"))]);
    expect(calls[0].init.headers.Authorization).toBe("Bearer expo-access");
  });

  it.each([
    [429, {}, "HTTP_429", true],
    [503, {}, "HTTP_5XX", true],
    [401, { errors: [{ code: "UNAUTHORIZED", message: "..." }] }, "UNAUTHORIZED", false],
    [400, { errors: [{ code: "PUSH_TOO_MANY_EXPERIENCE_IDS", message: "..." }] }, "PUSH_TOO_MANY_EXPERIENCE_IDS", false],
    [400, { errors: [{ code: "VALIDATION_ERROR", message: "malformed" }] }, "BAD_REQUEST", false],
  ])("HTTP %i with body %j -> %s (retry=%s); the raw provider message is not kept", async (status, body, code, retry) => {
    const t = createExpoPushTransport({ fetch: fakeFetch(status, body) });
    const res = await t.send([msg(TOK("a"))]);
    expect(res).toEqual({ ok: false, code, retry });
  });

  it("network failure and timeout are retryable", async () => {
    const net = createExpoPushTransport({ fetch: jest.fn(async () => { throw new Error("ECONNRESET secret-ish detail"); }) });
    expect(await net.send([msg(TOK("a"))])).toEqual({ ok: false, code: "NETWORK", retry: true });
    const slow = createExpoPushTransport({
      timeoutMs: 5,
      fetch: (_u, init) => new Promise((_, rej) => init.signal?.addEventListener("abort", () => rej(new Error("aborted")))),
    });
    expect(await slow.send([msg(TOK("a"))])).toEqual({ ok: false, code: "TIMEOUT", retry: true });
  });

  it("a malformed success body is a retryable BAD_RESPONSE; unknown error codes are reduced to a safe code", async () => {
    expect(await createExpoPushTransport({ fetch: fakeFetch(200, { data: [] }) }).send([msg(TOK("a"))])).toEqual({ ok: false, code: "BAD_RESPONSE", retry: true });
    const weird = createExpoPushTransport({ fetch: fakeFetch(200, { data: [{ status: "error", details: { error: "<script>alert(1)</script>" } }] }) });
    expect(await weird.send([msg(TOK("a"))])).toEqual({ ok: true, tickets: [{ status: "error", error: "UnknownError" }] });
  });

  it("refuses more than 100 messages per request", async () => {
    const f = fakeFetch(200, {});
    const t = createExpoPushTransport({ fetch: f });
    expect(await t.send(Array.from({ length: 101 }, (_, i) => msg(TOK(`m${i}`))))).toEqual({ ok: false, code: "PUSH_TOO_MANY_NOTIFICATIONS", retry: false });
    expect(f).not.toHaveBeenCalled();
  });

  it("receipts: missing ids are omitted; errors keep only the code", async () => {
    const calls: { url: string; init: { headers: Record<string, string>; body: string } }[] = [];
    const t = createExpoPushTransport({ fetch: fakeFetch(200, { data: { a: { status: "ok" }, b: { status: "error", message: "long text", details: { error: "DeviceNotRegistered" } } } }, calls) });
    expect(await t.getReceipts(["a", "b", "c"])).toEqual({ ok: true, receipts: { a: { status: "ok" }, b: { status: "error", error: "DeviceNotRegistered" } } });
    expect(calls[0].url).toBe(EXPO_RECEIPTS_URL);
  });
});

// ---------------------------------------------------------------------------
// Dispatch

describe("push dispatch", () => {
  it("sends one generic message per enabled device and records SENT", async () => {
    const store = new FakeStore();
    const transport = new FakeTransport();
    store.add("o1", notif({}), [TOK("aaaa"), TOK("bbbb")]);
    const s = await runPushDispatch({ store, transport });
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0].map((m) => m.to)).toEqual([TOK("aaaa"), TOK("bbbb")]);
    expect(transport.sent[0][0]).toMatchObject({ title: "Report verified", channelId: PUSH_CHANNEL_ID, sound: "default" });
    expect(s).toMatchObject({ claimed: 1, messages: 2, sent: 1, failed: 0 });
    expect(store.rows[0].status).toBe("SENT");
  });

  it("running again sends nothing (no duplicate push for the same notification)", async () => {
    const store = new FakeStore();
    const transport = new FakeTransport();
    store.add("o1", notif({}), [TOK("aaaa")]);
    await runPushDispatch({ store, transport });
    await runPushDispatch({ store, transport });
    expect(transport.sent.flat()).toHaveLength(1);
  });

  it("a temporary Expo failure is retried later, and a retry only goes to devices without a ticket", async () => {
    const store = new FakeStore();
    const transport = new FakeTransport();
    store.add("o1", notif({}), [TOK("aaaa"), TOK("bbbb")]);
    transport.ticketFor = (m) => (m.to === TOK("bbbb") ? { status: "error", error: "MessageRateExceeded" } : { status: "ok", ticketId: "ok-a" });
    const first = await runPushDispatch({ store, transport });
    expect(first.retrying).toBe(1);
    transport.ticketFor = () => ({ status: "ok", ticketId: "ok-b" });
    const second = await runPushDispatch({ store, transport });
    expect(second.sent).toBe(1);
    expect(transport.sent[1].map((m) => m.to)).toEqual([TOK("bbbb")]);
  });

  it("whole-request failures: transient codes retry, permanent ones fail; never more than 5 attempts", async () => {
    const store = new FakeStore();
    const transport = new FakeTransport();
    store.add("o1", notif({}), [TOK("aaaa")]);
    store.add("o2", notif({ id: "n-2" }), [TOK("cccc")]);
    transport.failNext = [{ ok: false, code: "HTTP_5XX", retry: true }];
    const s = await runPushDispatch({ store, transport });
    expect(s.retrying).toBe(2);
    expect(store.recorded.map((r) => r.requestError)).toEqual(["HTTP_5XX", "HTTP_5XX"]);
    for (let i = 0; i < 10; i++) {
      transport.failNext = [{ ok: false, code: "NETWORK", retry: true }];
      await runPushDispatch({ store, transport });
    }
    expect(store.rows.map((r) => [r.status, r.attempts])).toEqual([["FAILED", 5], ["FAILED", 5]]);

    const perm = new FakeStore();
    perm.add("p1", notif({}), [TOK("aaaa")]);
    const t2 = new FakeTransport();
    t2.failNext = [{ ok: false, code: "UNAUTHORIZED", retry: false }];
    await runPushDispatch({ store: perm, transport: t2 });
    expect(perm.rows[0].status).toBe("FAILED");
    expect(perm.recorded[0].requestError).toBe("UNAUTHORIZED");
  });

  it("DeviceNotRegistered disables the device; the notification is not retried to it", async () => {
    const store = new FakeStore();
    const transport = new FakeTransport();
    store.add("o1", notif({}), [TOK("aaaa")]);
    transport.ticketFor = () => ({ status: "error", error: "DeviceNotRegistered" });
    await runPushDispatch({ store, transport });
    expect(store.rows[0].devices[0].enabled).toBe(false);
    expect(store.rows[0].status).toBe("FAILED");
  });

  it("a malformed stored token is never sent (InvalidToken) and does not block other devices", async () => {
    const store = new FakeStore();
    const transport = new FakeTransport();
    store.add("o1", notif({}), ["not-a-token", TOK("aaaa")]);
    await runPushDispatch({ store, transport });
    expect(transport.sent.flat().map((m) => m.to)).toEqual([TOK("aaaa")]);
    expect(store.recorded[0].tickets).toEqual(expect.arrayContaining([{ device_id: "o1-d0", status: "error", error: "InvalidToken" }]));
    expect(store.rows[0].status).toBe("SENT");
  });

  it("a non-pushable claimed type is never sent", async () => {
    const store = new FakeStore();
    const transport = new FakeTransport();
    store.add("o1", notif({ type: "CASE_CLOSED_WITHOUT_CHARGE", recipient_role: "OFFICER" }), [TOK("aaaa")]);
    await runPushDispatch({ store, transport });
    expect(transport.sent).toHaveLength(0);
    expect(store.rows[0].status).toBe("FAILED");
  });

  it("no devices -> nothing sent, NO_DEVICE", async () => {
    const store = new FakeStore();
    const transport = new FakeTransport();
    store.add("o1", notif({}), []);
    const s = await runPushDispatch({ store, transport });
    expect(transport.sent).toHaveLength(0);
    expect(s.noDevice).toBe(1);
  });

  it("splits more than 100 messages into several requests", async () => {
    const store = new FakeStore();
    const transport = new FakeTransport();
    for (let i = 0; i < 60; i++) store.add(`o${i}`, notif({ id: `n${i}` }), [TOK(`a${i}aa`), TOK(`b${i}bb`)]);
    const s = await runPushDispatch({ store, transport, batchLimit: 100 });
    expect(transport.sent.map((c) => c.length)).toEqual([100, 20]);
    expect(s.sent).toBe(60);
  });

  it("checks receipts and records them (codes only)", async () => {
    const store = new FakeStore();
    const transport = new FakeTransport();
    store.pending = ["r1", "r2", "r3"];
    transport.receipts = { r1: { status: "ok" }, r2: { status: "error", error: "DeviceNotRegistered" } };
    const s = await runPushDispatch({ store, transport });
    expect(store.receiptsRecorded).toEqual([{ ticket_id: "r1", status: "ok" }, { ticket_id: "r2", status: "error", error: "DeviceNotRegistered" }]);
    expect(s.receiptsChecked).toBe(2);
  });

  it("logs counts and codes only - never tokens, titles or ids", async () => {
    const store = new FakeStore();
    const transport = new FakeTransport();
    store.add("o1", notif({}), [TOK("secretdevice")]);
    const lines: string[] = [];
    await runPushDispatch({ store, transport, log: (f) => lines.push(JSON.stringify(f)) });
    expect(lines.join("\n")).not.toMatch(/ExponentPushToken|secretdevice|Report verified|n-1|o1|100023/);
  });
});

// ---------------------------------------------------------------------------
// Handler

describe("push-dispatch handler", () => {
  const SECRET = "s".repeat(40);
  const req = (headers: Record<string, string> = {}, method = "POST") => new Request("https://fn.local/push-dispatch", { method, headers });
  const deps = (over = {}) => ({ secret: SECRET, store: new FakeStore(), transport: new FakeTransport(), ...over });

  it("refuses requests without the shared secret (and with a wrong one)", async () => {
    expect((await handlePushDispatch(req(), deps())).status).toBe(401);
    expect((await handlePushDispatch(req({ [DISPATCH_SECRET_HEADER]: "x".repeat(40) }), deps())).status).toBe(401);
    expect((await handlePushDispatch(req({ authorization: `Bearer ${SECRET}` }), deps())).status).toBe(401);
  });

  it("is unavailable (503) when not configured - nothing is sent", async () => {
    const transport = new FakeTransport();
    expect((await handlePushDispatch(req({ [DISPATCH_SECRET_HEADER]: SECRET }), deps({ secret: null, transport }))).status).toBe(503);
    expect((await handlePushDispatch(req({ [DISPATCH_SECRET_HEADER]: "short" }), deps({ secret: "short", transport }))).status).toBe(503);
    expect((await handlePushDispatch(req({ [DISPATCH_SECRET_HEADER]: SECRET }), deps({ store: null, transport }))).status).toBe(503);
    expect(transport.sent).toHaveLength(0);
  });

  it("only POST", async () => {
    expect((await handlePushDispatch(req({ [DISPATCH_SECRET_HEADER]: SECRET }, "GET"), deps())).status).toBe(405);
  });

  it("runs a dispatch and answers with counts only", async () => {
    const store = new FakeStore();
    store.add("o1", notif({}), [TOK("aaaa")]);
    const res = await handlePushDispatch(req({ [DISPATCH_SECRET_HEADER]: SECRET }), deps({ store }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ claimed: 1, sent: 1 });
    expect(JSON.stringify(body)).not.toMatch(/ExponentPushToken|Report verified/);
  });

  it("sameSecret is exact", () => {
    expect(sameSecret("abc", "abc")).toBe(true);
    expect(sameSecret("abc", "abd")).toBe(false);
    expect(sameSecret("abc", "abcd")).toBe(false);
  });
});
