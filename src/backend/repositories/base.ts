// Shared plumbing for repositories: get the configured client, require a
// real signed-in session (never invent one), and map every error.

import type { SupabaseClient } from "@supabase/supabase-js";
import { backendFail, BackendResult, mapBackendError, RawBackendError } from "../result";

/** Where repositories get their client from (injectable for offline tests). */
export type ClientProvider = () => BackendResult<SupabaseClient>;

export type RepoContext = { client: SupabaseClient; userId: string };

/** Run `fn` with a client and the CURRENT signed-in user. */
export async function withSession<T>(provider: ClientProvider, fn: (ctx: RepoContext) => Promise<BackendResult<T>>): Promise<BackendResult<T>> {
  const c = provider();
  if (!c.ok) return c;
  try {
    const { data, error } = await c.value.auth.getSession();
    if (error) return { ok: false, error: mapBackendError(error as RawBackendError, 401) };
    const userId = data.session?.user?.id;
    if (!userId) return backendFail("UNAUTHENTICATED", "Please sign in again.");
    return await fn({ client: c.value, userId });
  } catch {
    return backendFail("BACKEND_ERROR", "Something went wrong on the server. Please try again.");
  }
}

/** Normalise a supabase-js `{ data, error, status }` response. */
export function fromResponse<T>(res: { data: T | null; error: RawBackendError | null; status?: number }): BackendResult<T> {
  if (res.error) return { ok: false, error: mapBackendError(res.error, res.status) };
  if (res.data === null) return backendFail("NOT_FOUND", "We couldn't find that item.");
  return { ok: true, value: res.data };
}
