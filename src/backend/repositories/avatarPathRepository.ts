// The caller's own profile picture path (profiles.avatar_storage_path; RLS:
// profiles_select_own). Only the path is stored, never image data or a URL.

import type { SupabaseClient } from "@supabase/supabase-js";
import { ok, Result } from "../../domain";
import { mapRpcError, RawServerError } from "../operations/rpcErrors";

export async function getMyAvatarPath(client: SupabaseClient, userId: string): Promise<Result<string | null>> {
  try {
    const { data, error, status } = await client.from("profiles").select("avatar_storage_path").eq("id", userId).maybeSingle();
    if (error) return { ok: false, error: mapRpcError(error as RawServerError, status) };
    const p = (data as { avatar_storage_path?: string | null } | null)?.avatar_storage_path;
    return ok(typeof p === "string" && p ? p : null);
  } catch (e) {
    return { ok: false, error: mapRpcError(e as RawServerError) };
  }
}
