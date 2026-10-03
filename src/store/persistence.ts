import { ParkWatchState } from "./state";

/**
 * Versioned persisted-state format.
 *
 * { version, savedAt, state } is stored as JSON under one key. Bump
 * PERSIST_VERSION whenever ParkWatchState changes shape, and add a migration
 * in migrate(). Unknown/corrupt data is discarded (MVP mock data only), so a
 * bad payload can never crash startup.
 */
export const PERSIST_KEY = "parkwatch:state";
export const PERSIST_VERSION = 1;

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
  | { status: "ok"; state: ParkWatchState }
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
  const migrated = migrate(envelope.version, envelope.state);
  if (!migrated) return { status: "discarded", reason: `unsupported version ${envelope.version}` };
  if (!isStateShape(migrated)) return { status: "discarded", reason: "unexpected state shape" };
  return { status: "ok", state: migrated };
}

/** Upgrade older persisted versions here. Only v1 exists so far. */
function migrate(version: number, state: unknown): unknown | null {
  if (version === PERSIST_VERSION) return state;
  return null;
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
    typeof x.seq === "number" &&
    typeof x.nextReportNumber === "number"
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
