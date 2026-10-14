// Calls ParkWatch's recognize-plate Edge Function with the signed-in user's
// session (supabase-js adds the access token). The app only understands
// ParkWatch's response contract; the provider and its key stay on the server.

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseRecognitionResponse } from "../../../supabase/functions/_shared/plateText";
import type { PlateRecognizer, RecognitionError } from "../../presentation/plateScanFlow";

export type { PlateRecognizer };

export const RECOGNIZE_PLATE_FUNCTION = "recognize-plate";

/** HTTP status from the function -> plain error code. */
export function errorForStatus(status: number | undefined): RecognitionError {
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 429) return "RATE_LIMITED";
  if (status === 504) return "TIMEOUT";
  return "UNAVAILABLE";
}

export function createPlateRecognizer(client: SupabaseClient): PlateRecognizer {
  return async (image) => {
    try {
      const { data, error } = await client.functions.invoke(RECOGNIZE_PLATE_FUNCTION, { body: { image: image.base64, mimeType: image.mimeType } });
      if (error) {
        const name = (error as { name?: string }).name;
        if (name === "FunctionsFetchError") return { ok: false, error: "NETWORK" };
        const status = (error as { context?: { status?: number } }).context?.status;
        return { ok: false, error: errorForStatus(status) };
      }
      const parsed = parseRecognitionResponse(data);
      return parsed ? { ok: true, value: parsed } : { ok: false, error: "BAD_RESPONSE" };
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? "");
      return { ok: false, error: /abort|timeout/i.test(msg) ? "TIMEOUT" : "NETWORK" };
    }
  };
}
