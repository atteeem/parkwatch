import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthContext";
import { getSupabaseClient } from "../backend/supabase";
import { AvatarRepository, createAvatarRepository, removeAvatar, replaceAvatar } from "../backend/storage/avatarStorage";
import { AvatarSource, base64ToArrayBuffer, pickAvatarImage } from "../avatar/avatarImage";
import { asyncStorageAdapter } from "../store/asyncStorageAdapter";
import type { KeyValueStorage } from "../store/persistence";
import { DEV_CITIZEN_ID } from "../store/session";
import { describeDomainError } from "../presentation/errors";

// The signed-in user's profile picture.
//
// * BACKEND: stored in the private "profile-avatars" bucket; the profile row
//   holds only the path (set through set_my_avatar). Shown via a signed URL,
//   so it follows the account across restarts and devices.
// * LOCAL_DEMO: the shrunken JPEG is kept on this phone only (there is no account).

export type AvatarState = {
  /** Image to show, or undefined for the initials avatar. */
  uri?: string;
  busy: boolean;
  error: string | null;
  /** false while signed out (nothing to change). */
  canEdit: boolean;
  choose: (source: AvatarSource) => Promise<void>;
  remove: () => Promise<void>;
  clearError: () => void;
};

const AvatarContext = createContext<AvatarState | null>(null);

export const localAvatarKey = (accountId: string) => `parkwatch.avatar.v1.${accountId}`;

const newFileId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function AvatarProvider({
  children,
  storage = asyncStorageAdapter,
  repoFactory,
}: {
  children: React.ReactNode;
  storage?: KeyValueStorage;
  /** Injectable for tests. */
  repoFactory?: () => AvatarRepository | null;
}) {
  const { state: auth } = useAuth();
  const userId = auth.mode === "BACKEND" && auth.status === "authenticated" ? auth.user.id : null;
  const local = auth.mode === "LOCAL_DEMO";
  const repo = useMemo<AvatarRepository | null>(() => {
    if (!userId) return null;
    if (repoFactory) return repoFactory();
    const c = getSupabaseClient();
    return c.ok ? createAvatarRepository(c.value) : null;
  }, [userId, repoFactory]);

  const [uri, setUri] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load on sign-in / account switch; nothing carries over between accounts.
  useEffect(() => {
    setUri(undefined);
    setError(null);
    let live = true;
    if (local) {
      void storage.getItem(localAvatarKey(DEV_CITIZEN_ID)).then((v) => live && setUri(v ?? undefined), () => undefined);
    } else if (repo && userId) {
      void (async () => {
        const p = await repo.getMyAvatarPath(userId);
        if (!live || !p.ok || !p.value) return;
        const url = await repo.signedUrl(p.value);
        if (live && url.ok) setUri(url.value);
      })();
    }
    return () => {
      live = false;
    };
  }, [local, repo, userId, storage]);

  const choose = useCallback(
    async (source: AvatarSource) => {
      setError(null);
      const picked = await pickAvatarImage(source);
      if (!picked.ok) {
        if (picked.reason === "denied") setError("Camera access is off. Allow it in Settings to take a photo.");
        else if (picked.reason === "failed") setError("That photo could not be used. Please try another one.");
        return;
      }
      setBusy(true);
      try {
        if (local) {
          const dataUri = `data:image/jpeg;base64,${picked.base64}`;
          await storage.setItem(localAvatarKey(DEV_CITIZEN_ID), dataUri);
          setUri(dataUri);
        } else if (repo && userId) {
          const r = await replaceAvatar(repo, userId, newFileId(), base64ToArrayBuffer(picked.base64));
          if (r.ok) setUri(r.value.url);
          else setError(describeDomainError(r.error).message);
        }
      } catch {
        setError("The photo could not be saved. Please try again.");
      } finally {
        setBusy(false);
      }
    },
    [local, repo, userId, storage]
  );

  const remove = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      if (local) {
        await storage.removeItem(localAvatarKey(DEV_CITIZEN_ID));
        setUri(undefined);
      } else if (repo) {
        const r = await removeAvatar(repo);
        if (r.ok) setUri(undefined);
        else setError(describeDomainError(r.error).message);
      }
    } catch {
      setError("The photo could not be removed. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [local, repo, storage]);

  const value = useMemo<AvatarState>(
    () => ({ uri, busy, error, canEdit: local || !!repo, choose, remove, clearError: () => setError(null) }),
    [uri, busy, error, local, repo, choose, remove]
  );
  return <AvatarContext.Provider value={value}>{children}</AvatarContext.Provider>;
}

export function useMyAvatar(): AvatarState {
  const ctx = useContext(AvatarContext);
  if (!ctx) throw new Error("useMyAvatar must be used within AvatarProvider");
  return ctx;
}
