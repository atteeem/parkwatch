// Device registration RPCs (T9.2). The server binds every registration to
// auth.uid(): nothing here (or anywhere in the app) can name another user.
// Tokens are write-only from the app's point of view: no function returns them.

import type { SupabaseClient } from "@supabase/supabase-js";
import { ok, Result } from "../../domain";
import type { PushDeviceApi } from "../../push/pushTypes";
import { mapRpcError, RawServerError } from "../operations/rpcErrors";

export const PUSH_RPC_TIMEOUT_MS = 10_000;

export function createPushDeviceApi(client: SupabaseClient): PushDeviceApi {
  async function rpc(fn: string, args: Record<string, unknown>): Promise<Result<Record<string, unknown>>> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject({ message: "aborted (timeout)" }), PUSH_RPC_TIMEOUT_MS);
      });
      const { data, error, status } = await Promise.race([client.rpc(fn, args), timeout]);
      if (error) return { ok: false, error: mapRpcError(error as RawServerError, status) };
      return ok((data ?? {}) as Record<string, unknown>);
    } catch (e) {
      return { ok: false, error: mapRpcError(e as RawServerError) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return {
    async register(installationId, token, platform) {
      const r = await rpc("register_push_device", { p_installation_id: installationId, p_expo_push_token: token, p_platform: platform });
      return r.ok ? ok({ changed: r.value.changed === true }) : r;
    },
    async unregister(installationId) {
      const r = await rpc("unregister_push_device", { p_installation_id: installationId });
      return r.ok ? ok({ unregistered: r.value.unregistered === true }) : r;
    },
  };
}
