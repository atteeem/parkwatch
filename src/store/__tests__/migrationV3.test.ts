// v2 -> v3: removes obsolete fake seed notifications, repairs the seeded
// "bank transfer" copy and replaces random placeholder photo URLs, without
// touching real runtime data.

import { deserializeState, PERSIST_VERSION, serializeState } from "../persistence";
import { migrateV2toV3, OBSOLETE_SEED_NOTIFICATION_IDS } from "../migrations";
import { buildSeedState, SEED_WITHDRAWAL_PAID_COPY } from "../seed";
import { isDemoPhotoUri } from "../../data/demoPhotos";
import { ParkWatchState } from "../state";
import { CITIZEN, draft, expectOk, makeStore, NOW, OFFICER, snapshot, submitAndInspect } from "./helpers";

const officerSeedNotif = (id: string, title: string, body: string) => ({
  id,
  idempotencyKey: id,
  recipient: { role: "OFFICER" as const, accountId: "officer-demo" },
  type: "SYSTEM" as const,
  createdAt: NOW.toISOString(),
  title,
  body,
  displayHint: "bell",
});

/** A v2-era saved demo state: the old fake notifications + picsum seed photos + old withdrawal copy. */
function oldV2State(extra: ParkWatchState): ParkWatchState {
  const seed = buildSeedState(NOW);
  const picsum = (s: string) => `https://picsum.photos/seed/${s}/500/500`;
  return {
    ...extra,
    reports: [
      ...extra.reports,
      ...seed.reports.slice(0, 1).map((r) => ({ ...r, evidence: r.evidence.map((e) => ({ ...e, uri: picsum(`${r.id}-${e.type}`) })) })),
    ],
    notifications: [
      ...extra.notifications,
      officerSeedNotif("seed-shift", "Shift Completed", "You completed your shift successfully."),
      officerSeedNotif("seed-update", "System Update", "New AI license plate scanning is now available. Check out the new feature."),
      officerSeedNotif("seed-upcoming", "Upcoming Shift", "Your shift starts in 1 hour."),
      {
        ...officerSeedNotif("seed-withdrawal-2", "Withdrawal completed", "Your withdrawal of €25.00 has been sent to your bank account."),
        recipient: { role: "CITIZEN" as const, accountId: "citizen-demo" },
      },
    ],
  };
}

describe("v2 -> v3 demo cleanup", () => {
  it("removes the obsolete fake officer notifications by seed id", async () => {
    const { store } = await makeStore();
    submitAndInspect(store, "d1");
    const migrated = migrateV2toV3(oldV2State(snapshot(store)));
    const ids = migrated.notifications.map((n) => n.id);
    for (const id of OBSOLETE_SEED_NOTIFICATION_IDS) expect(ids).not.toContain(id);
    expect(JSON.stringify(migrated.notifications)).not.toMatch(/AI license plate/);
  });

  it("keeps every real runtime notification untouched", async () => {
    const { store } = await makeStore();
    const { caseId } = submitAndInspect(store, "d1");
    expectOk(store.completeCase(caseId, "CHARGE_ISSUED", OFFICER));
    const real = snapshot(store).notifications;
    const migrated = migrateV2toV3(oldV2State(snapshot(store)));
    expect(migrated.notifications.filter((n) => real.some((r) => r.id === n.id))).toEqual(real);
  });

  it("a runtime notification that happens to use similar text is not deleted", () => {
    const s = oldV2State({ ...buildSeedState(NOW), notifications: [officerSeedNotif("n-77", "System Update", "AI license plate scanning")] });
    expect(migrateV2toV3(s).notifications.map((n) => n.id)).toContain("n-77");
  });

  it("repairs the seeded withdrawal copy (no claimed bank transfer)", () => {
    const n = migrateV2toV3(oldV2State(buildSeedState(NOW))).notifications.find((x) => x.id === "seed-withdrawal-2")!;
    expect(n).toMatchObject(SEED_WITHDRAWAL_PAID_COPY);
    expect(n.body).not.toMatch(/bank/i);
  });

  it("replaces random placeholder URLs on SEED evidence only; camera photos keep their file URI", async () => {
    const { store } = await makeStore();
    submitAndInspect(store, "d1");
    const migrated = migrateV2toV3(oldV2State(snapshot(store)));
    const all = migrated.reports.flatMap((r) => r.evidence);
    expect(all.some((e) => e.uri.includes("picsum"))).toBe(false);
    expect(all.filter((e) => e.captureSource === "SEED").every((e) => isDemoPhotoUri(e.uri))).toBe(true);
    const camera = all.filter((e) => e.captureSource === "CAMERA");
    expect(camera.length).toBeGreaterThan(0);
    expect(camera.every((e) => e.uri.startsWith("file:///"))).toBe(true);
    const officer = Object.values(migrated.inspections).flatMap((i) => Object.values(i.officerEvidence));
    expect(officer.every((e) => e!.uri.startsWith("file:///"))).toBe(true);
  });

  it("is idempotent and a fresh v3 seed already needs nothing", () => {
    const once = migrateV2toV3(oldV2State(buildSeedState(NOW)));
    expect(migrateV2toV3(once)).toEqual(once);
    const fresh = buildSeedState(NOW);
    expect(migrateV2toV3(fresh)).toEqual(fresh);
  });

  it("loading a saved v2 envelope runs the cleanup; ids, ledger and balances are unchanged", async () => {
    const { store } = await makeStore();
    expectOk(store.submitReport(draft("d9"), CITIZEN));
    const v2 = oldV2State(snapshot(store));
    const envelope = JSON.parse(serializeState(v2, NOW.toISOString()));
    envelope.version = 2;
    const r = deserializeState(JSON.stringify(envelope));
    if (r.status !== "ok") throw new Error(JSON.stringify(r));
    expect(PERSIST_VERSION).toBe(4);
    expect(r.migratedFrom).toBe(2);
    expect(r.state.reports.map((x) => x.id)).toEqual(v2.reports.map((x) => x.id));
    expect(r.state.ledger).toEqual(v2.ledger);
    expect(r.state.nextReportNumber).toBe(v2.nextReportNumber);
    expect(r.state.seq).toBe(v2.seq + 2); // v3 -> v4 registers the two demo vehicles
    expect(r.state.notifications).toHaveLength(v2.notifications.length - OBSOLETE_SEED_NOTIFICATION_IDS.length);
  });
});

describe("fresh seed", () => {
  it("contains no fake officer notifications and no downloaded placeholder images", () => {
    const s = buildSeedState(NOW);
    expect(s.notifications.filter((n) => n.recipient.role === "OFFICER" && n.type === "SYSTEM")).toEqual([]);
    expect(JSON.stringify(s)).not.toMatch(/picsum|https?:\/\//);
  });
});
