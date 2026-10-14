// Device-local push state: the installation id and "Not now" choices.
//
// The installation id is a random value generated on first use and kept in
// app storage. It only lets the server dedupe this app installation's
// registrations; it is not an advertising id, hardware id or user id, and a
// reinstall gets a new one.

import type { KeyValueStorage } from "../store/persistence";

export const INSTALLATION_ID_KEY = "parkwatch.installationId.v1";
const EDUCATION_KEY = (role: string, userId: string) => `parkwatch.pushEducation.v1.${role}.${userId}`;
const INSTALLATION_ID = /^[A-Za-z0-9_-]{8,100}$/;

/** 128 random bits as "inst-" + 32 hex chars (crypto when available). */
export function newInstallationId(random: () => number = Math.random): string {
  const bytes = new Uint8Array(16);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(random() * 256);
  return `inst-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

let memo: Promise<string> | null = null;

/** This installation's id (created once, then reused). */
export function getInstallationId(storage: KeyValueStorage): Promise<string> {
  memo ??= (async () => {
    const existing = await storage.getItem(INSTALLATION_ID_KEY).catch(() => null);
    if (existing && INSTALLATION_ID.test(existing)) return existing;
    const id = newInstallationId();
    await storage.setItem(INSTALLATION_ID_KEY, id).catch(() => undefined);
    return id;
  })();
  return memo;
}

/** Tests only. */
export function resetInstallationIdCache() {
  memo = null;
}

export async function isEducationDismissed(storage: KeyValueStorage, role: string, userId: string): Promise<boolean> {
  return (await storage.getItem(EDUCATION_KEY(role, userId)).catch(() => null)) !== null;
}

export async function dismissEducation(storage: KeyValueStorage, role: string, userId: string): Promise<void> {
  await storage.setItem(EDUCATION_KEY(role, userId), new Date().toISOString()).catch(() => undefined);
}
