// push-dispatch: one run of the trusted push sender (pure; the database and
// the Expo transport are injected, so Jest drives it with fakes and the Edge
// Function with the real service-role RPCs and fetch).
//
//   1. claim due outbox rows (push_claim_batch: leased, attempts counted)
//   2. build GENERIC messages from the notification type (pushContent.ts)
//   3. send to Expo in requests of <= 100 messages
//   4. record per-device tickets / the request failure per outbox row
//      (push_record_result decides SENT / retry with backoff / FAILED and
//      disables DeviceNotRegistered devices)
//   5. check receipts of tickets older than 15 minutes (push_record_receipts)
//
// Idempotency: an outbox row exists once per notification; a row is leased
// while being sent; a device that already has a ticket is never sent the same
// notification again. Logs carry counts and short codes only - never tokens,
// ids, titles or bodies.

import { ClaimedNotification, EXPO_PUSH_TOKEN, PUSH_CHANNEL_ID, pushContentFor } from "./pushContent.ts";
import { ExpoMessage, MAX_MESSAGES_PER_REQUEST, MAX_RECEIPTS_PER_REQUEST, PushTransport } from "./expoPushTransport.ts";

export type ClaimedDevice = { device_id: string; token: string; platform: string };
export type ClaimedPush = { outbox_id: string; attempt: number; notification: ClaimedNotification; devices: ClaimedDevice[] };
export type TicketResult = { device_id: string; status: "ok"; ticket_id: string } | { device_id: string; status: "error"; error: string };

export type PushStore = {
  claim(limit: number): Promise<ClaimedPush[]>;
  recordResult(outboxId: string, tickets: TicketResult[], requestError: string | null): Promise<{ status: string }>;
  pendingReceipts(limit: number): Promise<string[]>;
  recordReceipts(receipts: { ticket_id: string; status: "ok" | "error"; error?: string }[]): Promise<{ recorded: number }>;
};

export type DispatchSummary = {
  claimed: number;
  messages: number;
  sent: number;
  retrying: number;
  failed: number;
  noDevice: number;
  receiptsChecked: number;
  errors: string[];
};

export async function runPushDispatch(deps: {
  store: PushStore;
  transport: PushTransport;
  batchLimit?: number;
  log?: (fields: Record<string, unknown>) => void;
}): Promise<DispatchSummary> {
  const summary: DispatchSummary = { claimed: 0, messages: 0, sent: 0, retrying: 0, failed: 0, noDevice: 0, receiptsChecked: 0, errors: [] };
  const claimed = await deps.store.claim(deps.batchLimit ?? 50);
  summary.claimed = claimed.length;

  // Per outbox row: tickets collected so far and the first request failure.
  const results = new Map<string, { tickets: TicketResult[]; requestError: string | null }>();
  const queue: { outboxId: string; deviceId: string; message: ExpoMessage }[] = [];
  for (const c of claimed) {
    const r = { tickets: [] as TicketResult[], requestError: null as string | null };
    results.set(c.outbox_id, r);
    const content = pushContentFor(c.notification);
    for (const d of c.devices) {
      if (!content) {
        r.tickets.push({ device_id: d.device_id, status: "error", error: "NotPushable" });
      } else if (!EXPO_PUSH_TOKEN.test(d.token)) {
        r.tickets.push({ device_id: d.device_id, status: "error", error: "InvalidToken" });
      } else {
        queue.push({
          outboxId: c.outbox_id,
          deviceId: d.device_id,
          message: {
            to: d.token,
            title: content.title,
            body: content.body,
            data: content.data,
            sound: "default",
            priority: content.priority,
            ttl: content.ttlSeconds,
            channelId: PUSH_CHANNEL_ID,
          },
        });
      }
    }
  }

  for (let i = 0; i < queue.length; i += MAX_MESSAGES_PER_REQUEST) {
    const chunk = queue.slice(i, i + MAX_MESSAGES_PER_REQUEST);
    summary.messages += chunk.length;
    const res = await deps.transport.send(chunk.map((x) => x.message));
    if (!res.ok) {
      if (!summary.errors.includes(res.code)) summary.errors.push(res.code);
      // A permanent failure is recorded as such; a transient one is retried by the database (backoff).
      for (const x of chunk) {
        const r = results.get(x.outboxId)!;
        r.requestError ??= res.retry ? res.code : permanentCode(res.code);
      }
      continue;
    }
    chunk.forEach((x, k) => {
      const t = res.tickets[k];
      results
        .get(x.outboxId)!
        .tickets.push(t.status === "ok" ? { device_id: x.deviceId, status: "ok", ticket_id: t.ticketId } : { device_id: x.deviceId, status: "error", error: t.error });
    });
  }

  for (const [outboxId, r] of results) {
    try {
      const { status } = await deps.store.recordResult(outboxId, r.tickets, r.requestError);
      if (status === "SENT") summary.sent += 1;
      else if (status === "PENDING") summary.retrying += 1;
      else if (status === "NO_DEVICE") summary.noDevice += 1;
      else if (status === "FAILED") summary.failed += 1;
    } catch {
      // The lease expires and the row is claimed again; devices with tickets are skipped then.
      if (!summary.errors.includes("RECORD_FAILED")) summary.errors.push("RECORD_FAILED");
    }
  }

  // Receipts (DeviceNotRegistered can also arrive here).
  try {
    const ids = await deps.store.pendingReceipts(MAX_RECEIPTS_PER_REQUEST);
    if (ids.length) {
      const res = await deps.transport.getReceipts(ids);
      if (res.ok) {
        const rows = Object.entries(res.receipts).map(([ticket_id, rc]) =>
          rc.status === "ok" ? { ticket_id, status: "ok" as const } : { ticket_id, status: "error" as const, error: rc.error }
        );
        if (rows.length) summary.receiptsChecked = (await deps.store.recordReceipts(rows)).recorded;
      } else if (!summary.errors.includes(res.code)) {
        summary.errors.push(res.code);
      }
    }
  } catch {
    if (!summary.errors.includes("RECEIPTS_FAILED")) summary.errors.push("RECEIPTS_FAILED");
  }

  deps.log?.({ fn: "push-dispatch", ...summary });
  return summary;
}

/** Codes push_record_result treats as permanent (no retry). */
function permanentCode(code: string): string {
  return code === "UNAUTHORIZED" || code === "PUSH_TOO_MANY_EXPERIENCE_IDS" ? code : "BAD_REQUEST";
}
