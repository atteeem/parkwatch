// Expo Push Service client (pure Web fetch, so it runs in Deno and in Jest
// with a fake fetch). Only short codes leave this module; raw provider
// responses are never stored or shown.
//
//   send:      POST https://exp.host/--/api/v2/push/send          (<= 100 messages)
//   receipts:  POST https://exp.host/--/api/v2/push/getReceipts   (<= 1000 ids)
// Optional EXPO_ACCESS_TOKEN (Expo "enhanced push security").

export const EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send";
export const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
export const MAX_MESSAGES_PER_REQUEST = 100;
export const MAX_RECEIPTS_PER_REQUEST = 1000;
export const EXPO_TIMEOUT_MS = 10_000;

export type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: "default";
  priority: "default" | "high";
  ttl: number;
  channelId: string;
};

/** One result per message, in order. */
export type DeviceTicket = { status: "ok"; ticketId: string } | { status: "error"; error: string };
export type Receipt = { status: "ok" } | { status: "error"; error: string };

/** A whole-request failure. `retry` = worth trying again later. */
export type RequestFailure = { ok: false; code: string; retry: boolean };

export type PushTransport = {
  send(messages: ExpoMessage[]): Promise<{ ok: true; tickets: DeviceTicket[] } | RequestFailure>;
  getReceipts(ids: string[]): Promise<{ ok: true; receipts: Record<string, Receipt> } | RequestFailure>;
};

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  status: number;
  json(): Promise<unknown>;
}>;

const CODE = /^[A-Za-z][A-Za-z0-9_]{1,39}$/;
/** A provider error code reduced to a safe short code. */
export const safeCode = (v: unknown, fallback = "UnknownError") => (typeof v === "string" && CODE.test(v) ? v : fallback);

const PERMANENT_REQUEST_ERRORS = new Set(["PUSH_TOO_MANY_EXPERIENCE_IDS", "UNAUTHORIZED", "PUSH_TOO_MANY_NOTIFICATIONS", "PUSH_TOO_MANY_RECEIPTS"]);

function failureForStatus(status: number, body: unknown): RequestFailure {
  const first = (body as { errors?: { code?: unknown }[] } | null)?.errors?.[0]?.code;
  const code = typeof first === "string" && CODE.test(first) ? first : null;
  if (code && PERMANENT_REQUEST_ERRORS.has(code)) return { ok: false, code, retry: false };
  if (status === 429 || code === "TOO_MANY_REQUESTS") return { ok: false, code: "HTTP_429", retry: true };
  if (status >= 500) return { ok: false, code: "HTTP_5XX", retry: true };
  if (status === 401 || status === 403) return { ok: false, code: "UNAUTHORIZED", retry: false };
  return { ok: false, code: "BAD_REQUEST", retry: false };
}

export function createExpoPushTransport(opts: { fetch: FetchLike; accessToken?: string | null; timeoutMs?: number }): PushTransport {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(opts.accessToken ? { Authorization: `Bearer ${opts.accessToken}` } : {}),
  };
  const timeoutMs = opts.timeoutMs ?? EXPO_TIMEOUT_MS;

  async function post(url: string, body: unknown): Promise<{ status: number; json: unknown } | RequestFailure> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await opts.fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: ctrl.signal });
      const json = await res.json().catch(() => null);
      return { status: res.status, json };
    } catch (e) {
      return { ok: false, code: ctrl.signal.aborted ? "TIMEOUT" : "NETWORK", retry: true };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async send(messages) {
      if (messages.length === 0) return { ok: true, tickets: [] };
      if (messages.length > MAX_MESSAGES_PER_REQUEST) return { ok: false, code: "PUSH_TOO_MANY_NOTIFICATIONS", retry: false };
      const res = await post(EXPO_SEND_URL, messages);
      if ("ok" in res) return res;
      if (res.status !== 200) return failureForStatus(res.status, res.json);
      const data = (res.json as { data?: unknown } | null)?.data;
      if (!Array.isArray(data) || data.length !== messages.length) return { ok: false, code: "BAD_RESPONSE", retry: true };
      const tickets = data.map((t): DeviceTicket => {
        const x = t as { status?: unknown; id?: unknown; details?: { error?: unknown } } | null;
        if (x?.status === "ok" && typeof x.id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(x.id)) return { status: "ok", ticketId: x.id };
        return { status: "error", error: safeCode(x?.details?.error) };
      });
      return { ok: true, tickets };
    },
    async getReceipts(ids) {
      if (ids.length === 0) return { ok: true, receipts: {} };
      if (ids.length > MAX_RECEIPTS_PER_REQUEST) return { ok: false, code: "PUSH_TOO_MANY_RECEIPTS", retry: false };
      const res = await post(EXPO_RECEIPTS_URL, { ids });
      if ("ok" in res) return res;
      if (res.status !== 200) return failureForStatus(res.status, res.json);
      const data = (res.json as { data?: unknown } | null)?.data;
      if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, code: "BAD_RESPONSE", retry: true };
      const receipts: Record<string, Receipt> = {};
      for (const id of ids) {
        const x = (data as Record<string, { status?: unknown; details?: { error?: unknown } }>)[id];
        if (!x) continue; // not available yet
        receipts[id] = x.status === "ok" ? { status: "ok" } : { status: "error", error: safeCode(x.details?.error) };
      }
      return { ok: true, receipts };
    },
  };
}
