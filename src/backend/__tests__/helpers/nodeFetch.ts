// Test helper: a minimal fetch over Node's http module. The Expo Jest preset
// replaces the global fetch with a native-module polyfill that cannot make
// real requests, so integration tests pass this to supabase-js instead.
import * as http from "http";

type Init = { method?: string; headers?: unknown; body?: unknown };

function headersToObject(h: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (typeof (h as { forEach?: unknown }).forEach === "function" && !Array.isArray(h)) {
    (h as { forEach(cb: (v: string, k: string) => void): void }).forEach((v, k) => (out[k] = v));
  } else if (Array.isArray(h)) {
    for (const [k, v] of h as [string, string][]) out[k] = v;
  } else Object.assign(out, h as Record<string, string>);
  return out;
}

async function bodyToBuffer(b: unknown): Promise<Buffer | undefined> {
  if (b === undefined || b === null) return undefined;
  if (typeof b === "string") return Buffer.from(b);
  if (Object.prototype.toString.call(b) === "[object ArrayBuffer]") return Buffer.from(new Uint8Array(b as ArrayBuffer));
  if (ArrayBuffer.isView(b)) return Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  if (typeof (b as { arrayBuffer?: unknown }).arrayBuffer === "function") return Buffer.from(await (b as Blob).arrayBuffer());
  return Buffer.from(String(b));
}

export async function nodeFetch(input: unknown, init: Init = {}): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : (input as { url?: string }).url ?? String(input));
  const headers = headersToObject(init.headers);
  const body = await bodyToBuffer(init.body);
  if (body) headers["content-length"] = String(body.length);
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: init.method ?? "GET", headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) flat[k] = Array.isArray(v) ? v.join(", ") : v;
        const status = res.statusCode ?? 0;
        const response = {
          ok: status >= 200 && status < 300,
          status,
          statusText: res.statusMessage ?? "",
          url: url.toString(),
          headers: new Headers(flat),
          text: async () => buf.toString("utf8"),
          json: async () => JSON.parse(buf.toString("utf8")),
          arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
          clone() {
            return response;
          },
        };
        resolve(response as unknown as Response);
      });
    });
    // Same shape as a browser/RN network failure.
    req.on("error", () => reject(new TypeError("fetch failed")));
    if (body) req.write(body);
    req.end();
  });
}
