// Profile pictures (T8.7). Storage side; the profile path read is in repositories/avatarPathRepository. Private bucket "profile-avatars": the profile row
// stores only the object path; the app shows the picture through a short-lived
// signed URL. Only the owner can read or change their own folder (storage RLS),
// and the profile column changes only through set_my_avatar() (server-checked).

import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError, fail, ok, Result } from "../../domain";
import { mapRpcError, RawServerError } from "../operations/rpcErrors";
import { SIGNED_URL_TTL_SECONDS } from "./evidenceStorage";
import { getMyAvatarPath } from "../repositories/avatarPathRepository";

export const AVATAR_BUCKET = "profile-avatars";

/** "<user id>/<file id>.jpg" (the server accepts only the caller's own folder). */
export const avatarPath = (userId: string, fileId: string): string => `${userId}/${fileId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64)}.jpg`;

export type AvatarRepository = {
  getMyAvatarPath(userId: string): Promise<Result<string | null>>;
  upload(path: string, bytes: ArrayBuffer): Promise<Result<true>>;
  /** Server: set (path) or clear (null) the caller's avatar; returns the replaced path. */
  setMyAvatar(path: string | null): Promise<Result<{ previousPath: string | null }>>;
  removeObject(path: string): Promise<Result<true>>;
  signedUrl(path: string): Promise<Result<string>>;
};

const asError = (e: unknown): DomainError => mapRpcError(e as RawServerError);

export function createAvatarRepository(client: SupabaseClient): AvatarRepository {
  const bucket = () => client.storage.from(AVATAR_BUCKET);
  return {
    getMyAvatarPath: (userId) => getMyAvatarPath(client, userId),
    async upload(path, bytes) {
      try {
        const { error } = await bucket().upload(path, bytes, { contentType: "image/jpeg", upsert: false });
        return error ? fail("UPLOAD_FAILED", "UPLOAD_FAILED") : ok(true as const);
      } catch (e) {
        const mapped = asError(e);
        return mapped.code === "NETWORK_ERROR" ? { ok: false, error: mapped } : fail("UPLOAD_FAILED", "UPLOAD_FAILED");
      }
    },
    async setMyAvatar(path) {
      try {
        const { data, error, status } = await client.rpc("set_my_avatar", { p_path: path });
        if (error) return { ok: false, error: mapRpcError(error as RawServerError, status) };
        const prev = (data as { previous_path?: string | null } | null)?.previous_path;
        return ok({ previousPath: typeof prev === "string" && prev ? prev : null });
      } catch (e) {
        return { ok: false, error: asError(e) };
      }
    },
    async removeObject(path) {
      try {
        const { error } = await bucket().remove([path]);
        return error ? fail("BACKEND_ERROR", "BACKEND_ERROR") : ok(true as const);
      } catch (e) {
        return { ok: false, error: asError(e) };
      }
    },
    async signedUrl(path) {
      try {
        const { data, error } = await bucket().createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
        return error || !data?.signedUrl ? fail("BACKEND_ERROR", "BACKEND_ERROR") : ok(data.signedUrl);
      } catch (e) {
        return { ok: false, error: asError(e) };
      }
    },
  };
}

/**
 * Replace the avatar: upload a NEW object, point the profile at it, then delete
 * the replaced object (old avatars never pile up). If the profile update fails,
 * the just-uploaded object is removed again and the old avatar stays.
 */
export async function replaceAvatar(repo: AvatarRepository, userId: string, fileId: string, bytes: ArrayBuffer): Promise<Result<{ path: string; url: string }>> {
  const path = avatarPath(userId, fileId);
  const up = await repo.upload(path, bytes);
  if (!up.ok) return up;
  const set = await repo.setMyAvatar(path);
  if (!set.ok) {
    await repo.removeObject(path);
    return set;
  }
  if (set.value.previousPath && set.value.previousPath !== path) await repo.removeObject(set.value.previousPath);
  const url = await repo.signedUrl(path);
  return url.ok ? ok({ path, url: url.value }) : url;
}

/** Remove the avatar: clear the profile first, then delete the object. */
export async function removeAvatar(repo: AvatarRepository): Promise<Result<true>> {
  const set = await repo.setMyAvatar(null);
  if (!set.ok) return set;
  if (set.value.previousPath) await repo.removeObject(set.value.previousPath);
  return ok(true as const);
}
