import { migrateV1toV2, migrateV2toV3, migrateV3toV4, migrateV4toV5, V1State, V3State } from "./migrations";
import { ParkWatchState } from "./state";

/**
 * Versioned persisted-state format.
 *
 * { version, savedAt, state } is stored as JSON under one key. Bump
 * PERSIST_VERSION whenever ParkWatchState changes shape, and add a migration
 * step in migrate(). Older versions are MIGRATED, never discarded. Only
 * unreadable data (invalid JSON, unknown/future version, wrong shape) is
 * discarded, so a bad payload can never crash startup.
 *
 * v1 -> v2: plate value objects, evidence captureSource, jurisdictionId,
 * actor/source on events, report event log (see migrations.ts).
 */
export const PERSIST_KEY = "parkwatch:state";
export const PERSIST_VERSION = 5;

export type PersistedEnvelope = { version: number; savedAt: string; state: ParkWatchState };

/** Minimal async key-value interface; AsyncStorage in the app, in-memory in tests. */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function serializeState(state: ParkWatchState, savedAt: string): string {
  const envelope: PersistedEnvelope = { version: PERSIST_VERSION, savedAt, state };
  return JSON.stringify(envelope);
}

export type DeserializeResult =
  | { status: "ok"; state: ParkWatchState; migratedFrom?: number }
  | { status: "empty" }
  | { status: "discarded"; reason: string };

export function deserializeState(raw: string | null): DeserializeResult {
  if (raw === null) return { status: "empty" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "discarded", reason: "invalid JSON" };
  }
  const envelope = parsed as Partial<PersistedEnvelope>;
  if (typeof envelope?.version !== "number") return { status: "discarded", reason: "missing version" };
  if (envelope.version > PERSIST_VERSION || envelope.version < 1) {
    return { status: "discarded", reason: `unsupported version ${envelope.version}` };
  }
  let migrated: unknown;
  try {
    migrated = migrate(envelope.version, envelope.state, typeof envelope.savedAt === "string" ? envelope.savedAt : new Date(0).toISOString());
  } catch {
    return { status: "discarded", reason: `v${envelope.version} migration failed` };
  }
  if (!isStateShape(migrated)) return { status: "discarded", reason: "unexpected state shape" };
  return envelope.version === PERSIST_VERSION
    ? { status: "ok", state: migrated }
    : { status: "ok", state: migrated, migratedFrom: envelope.version };
}

/** Apply each migration step from `version` up to PERSIST_VERSION. */
function migrate(version: number, state: unknown, savedAt: string): unknown {
  let s = state;
  if (version < 2) s = migrateV1toV2(s as V1State);
  if (version < 3) s = migrateV2toV3(s as ParkWatchState);
  if (version < 4) s = migrateV3toV4(s as V3State, savedAt);
  if (version < 5) s = migrateV4toV5(s as ParkWatchState);
  return s;
}

function isStateShape(s: unknown): s is ParkWatchState {
  if (typeof s !== "object" || s === null) return false;
  const x = s as Record<string, unknown>;
  return (
    Array.isArray(x.reports) &&
    Array.isArray(x.cases) &&
    typeof x.inspections === "object" &&
    x.inspections !== null &&
    !Array.isArray(x.inspections) &&
    Array.isArray(x.ledger) &&
    Array.isArray(x.notifications) &&
    Array.isArray(x.vehicles) &&
    Array.isArray(x.parkingSessions) &&
    typeof x.seq === "number" &&
    typeof x.nextReportNumber === "number" &&
    (x.reports as Record<string, unknown>[]).every((r) => typeof r.jurisdictionId === "string" && Array.isArray(r.events)) &&
    (x.cases as Record<string, unknown>[]).every((c) => typeof c.jurisdictionId === "string")
  );
}

export function createMemoryStorage(initial: Record<string, string> = {}): KeyValueStorage & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    async getItem(key) {
      return key in data ? data[key] : null;
    },
    async setItem(key, value) {
      data[key] = value;
    },
    async removeItem(key) {
      delete data[key];
    },
  };
}
