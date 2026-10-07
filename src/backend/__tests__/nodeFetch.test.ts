/**
 * @jest-environment node
 */
// The test transport helper picks Node's http or https by URL protocol: the
// local mock backend is http, real Supabase projects are https.
import * as nodeHttp from "http";

// Pass-through http (so a real local server works) with call tracking; https is
// faked (no certificate or network needed) to prove which transport is chosen.
jest.mock("http", () => {
  const actual = jest.requireActual("http");
  return { ...actual, request: jest.fn((...args: unknown[]) => actual.request(...args)) };
});
jest.mock("https", () => {
  const actual = jest.requireActual("https");
  return {
    ...actual,
    request: jest.fn((_url: URL, _opts: unknown, cb: (res: unknown) => void) => {
      const { EventEmitter } = jest.requireActual("events");
      const { Readable } = jest.requireActual("stream");
      const req = new EventEmitter() as import("events").EventEmitter & { write: (b: Buffer) => void; end: () => void; written: Buffer[] };
      req.written = [];
      req.write = (b: Buffer) => void req.written.push(b);
      req.end = () => {
        const res = Readable.from([Buffer.from(JSON.stringify({ secure: true }))]);
        Object.assign(res, { statusCode: 201, statusMessage: "Created", headers: { "content-type": "application/json", "x-test": ["a", "b"] } });
        cb(res);
      };
      return req;
    }),
  };
});

// eslint-disable-next-line import/first
import * as http from "http";
// eslint-disable-next-line import/first
import * as https from "https";
// eslint-disable-next-line import/first
import { nodeFetch } from "./helpers/nodeFetch";

const httpRequest = http.request as unknown as jest.Mock;
const httpsRequest = https.request as unknown as jest.Mock;

let server: nodeHttp.Server;
let port = 0;

beforeAll(async () => {
  server = jest.requireActual<typeof nodeHttp>("http").createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json", "x-echo": req.headers["x-echo"] ?? "" });
      res.end(JSON.stringify({ method: req.method, path: req.url, body: Buffer.concat(chunks).toString("utf8") }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as { port: number }).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  httpRequest.mockClear();
  httpsRequest.mockClear();
});

describe("nodeFetch transport selection", () => {
  it("http: uses http.request and keeps the fetch-like response (local mock backend)", async () => {
    const res = await nodeFetch(`http://127.0.0.1:${port}/rest/v1/rpc/x`, { method: "POST", headers: { "x-echo": "hi" }, body: "payload" });
    expect(httpRequest).toHaveBeenCalledTimes(1);
    expect(httpsRequest).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-echo")).toBe("hi");
    expect(await res.json()).toEqual({ method: "POST", path: "/rest/v1/rpc/x", body: "payload" });
  });

  it("https: uses https.request (real Supabase URLs) with the same response shape and body handling", async () => {
    const res = await nodeFetch("https://example-project.supabase.co/rest/v1/rpc/get_citizen_summary", {
      method: "POST",
      headers: new Headers({ apikey: "k" }),
      body: new Uint8Array([1, 2, 3]),
    });
    expect(httpsRequest).toHaveBeenCalledTimes(1);
    expect(httpRequest).not.toHaveBeenCalled();
    const [url, opts] = httpsRequest.mock.calls[0];
    expect(String(url)).toBe("https://example-project.supabase.co/rest/v1/rpc/get_citizen_summary");
    expect(opts).toMatchObject({ method: "POST", headers: { apikey: "k", "content-length": "3" } });
    expect(Buffer.concat(httpsRequest.mock.results[0].value.written)).toEqual(Buffer.from([1, 2, 3]));
    expect(res.ok).toBe(true);
    expect(res.status).toBe(201);
    expect(res.statusText).toBe("Created");
    expect(res.headers.get("x-test")).toBe("a, b");
    expect(await res.json()).toEqual({ secure: true });
  });

  it("rejects unsupported protocols explicitly, without using any transport", async () => {
    await expect(nodeFetch("ftp://example.test/file")).rejects.toThrow(new TypeError("Unsupported protocol: ftp:"));
    await expect(nodeFetch("file:///etc/hosts")).rejects.toThrow(/Unsupported protocol: file:/);
    expect(httpRequest).not.toHaveBeenCalled();
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it("a connection failure is still reported like a browser network failure", async () => {
    await expect(nodeFetch("http://127.0.0.1:9/")).rejects.toThrow(new TypeError("fetch failed"));
  });
});
