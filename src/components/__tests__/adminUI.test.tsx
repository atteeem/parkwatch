// T9.0 console UI states: loading, empty, error + retry, unauthorized,
// session ended, not found, and server paging ("Load more", failed later page).
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text } from "react-native";
import { EmptyRows, FailureState, ListFooter, NotFoundState, PagedStates, useAdminLoad, useAdminPaged } from "../../admin/AdminUI";
import type { AdminPage } from "../../admin/adminTypes";
import type { Result } from "../../domain";

jest.mock("@expo/vector-icons", () => ({ Ionicons: Object.assign(() => null, { glyphMap: {} }) }));

const texts = (r: TestRenderer.ReactTestRenderer) => r.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
const press = async (r: TestRenderer.ReactTestRenderer, label: string) => {
  const btn = r.root.find((n) => typeof n.props.onPress === "function" && typeof n.type !== "string" && texts({ root: n } as never).some((t) => t === label));
  await act(async () => btn.props.onPress());
  await act(async () => undefined);
};
const okPage = <T,>(rows: T[], total: number, nextOffset: number | null): Result<AdminPage<T>> => ({ ok: true, value: { rows, total, nextOffset } });

function PagedProbe({ fetch, k = "a" }: { fetch: (offset: number) => Promise<Result<AdminPage<string>>>; k?: string }) {
  const p = useAdminPaged(fetch, k);
  return (
    <>
      <PagedStates p={p} emptyTitle="No reports" emptyBody="Nothing here." />
      {p.rows.map((x) => (
        <Text key={x}>{`row:${x}`}</Text>
      ))}
      {p.rows.length ? <ListFooter p={p} /> : null}
    </>
  );
}

async function mount(el: React.ReactElement) {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    r = TestRenderer.create(el);
  });
  await act(async () => undefined);
  return r;
}

describe("paged lists", () => {
  it("first page, 'Load more' appends the next server page, then stops", async () => {
    const fetch = jest.fn(async (offset: number) => (offset === 0 ? okPage(["a", "b"], 3, 2) : okPage(["c"], 3, null)));
    const r = await mount(<PagedProbe fetch={fetch} />);
    expect(texts(r)).toEqual(expect.arrayContaining(["row:a", "row:b", "Showing 2 of 3", "Load more"]));
    await press(r, "Load more");
    expect(fetch).toHaveBeenLastCalledWith(2);
    expect(texts(r)).toEqual(expect.arrayContaining(["row:c", "3 results"]));
    expect(texts(r)).not.toContain("Load more");
  });

  it("changing the filters starts again at page 1 (server filtering, not the loaded rows)", async () => {
    const fetch = jest.fn(async (_offset: number) => okPage(["a"], 1, null));
    const r = await mount(<PagedProbe fetch={fetch} k="status=NEW" />);
    await act(async () => r.update(<PagedProbe fetch={fetch} k="status=COMPLETED" />));
    await act(async () => undefined);
    expect(fetch.mock.calls.map((c: unknown[]) => c[0])).toEqual([0, 0]);
  });

  it("empty result shows the empty state", async () => {
    const r = await mount(<PagedProbe fetch={async () => okPage([], 0, null)} />);
    expect(texts(r)).toEqual(expect.arrayContaining(["No reports", "Nothing here."]));
  });

  it("a failed first page shows an error with Try again, which reloads", async () => {
    let n = 0;
    const fetch = jest.fn(async () => (++n === 1 ? ({ ok: false, error: { code: "NETWORK_ERROR", message: "x" } } as const) : okPage(["a"], 1, null)));
    const r = await mount(<PagedProbe fetch={fetch} />);
    expect(texts(r)).toContain("Couldn't load this");
    await press(r, "Try again");
    expect(texts(r)).toContain("row:a");
  });

  it("a failed later page keeps the rows and offers a retry", async () => {
    let n = 0;
    const fetch = jest.fn(async (offset: number) => (offset === 0 ? okPage(["a"], 2, 1) : ++n === 1 ? ({ ok: false, error: { code: "NETWORK_ERROR", message: "x" } } as const) : okPage(["b"], 2, null)));
    const r = await mount(<PagedProbe fetch={fetch} />);
    await press(r, "Load more");
    expect(texts(r)).toEqual(expect.arrayContaining(["row:a", "Try again"]));
    await press(r, "Try again");
    expect(texts(r)).toContain("row:b");
  });

  it("FORBIDDEN -> no access (not an error with raw text)", async () => {
    const r = await mount(<PagedProbe fetch={async () => ({ ok: false, error: { code: "FORBIDDEN", message: "FORBIDDEN: internal detail" } })} />);
    expect(texts(r)).toContain("No access");
    expect(texts(r).join(" ")).not.toMatch(/internal detail/);
  });
});

describe("single loads and states", () => {
  function LoadProbe({ load }: { load: () => Promise<Result<string | null>> }) {
    const s = useAdminLoad(load, "k");
    if (s.phase === "loading") return <Text>loading</Text>;
    if (s.phase === "failed") return <FailureState failure={s.failure} onRetry={s.reload} />;
    return s.data ? <Text>{s.data}</Text> : <NotFoundState what="Report" onBack={() => undefined} />;
  }

  it("loading, then the data", async () => {
    let resolve!: (v: Result<string | null>) => void;
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<LoadProbe load={() => new Promise((res) => (resolve = res))} />);
    });
    expect(texts(r)).toContain("loading");
    await act(async () => resolve({ ok: true, value: "Report 100023" }));
    expect(texts(r)).toContain("Report 100023");
  });

  it("missing (or another organization's) record -> not found", async () => {
    const r = await mount(<LoadProbe load={async () => ({ ok: true, value: null })} />);
    expect(texts(r)).toEqual(expect.arrayContaining(["Report not found", "It doesn't exist, or it isn't part of your organization."]));
  });

  it("expired session -> sign in again", async () => {
    const r = await mount(<LoadProbe load={async () => ({ ok: false, error: { code: "UNAUTHENTICATED", message: "x" } })} />);
    expect(texts(r)).toContain("Your session has ended");
  });

  it("empty rows component", async () => {
    const r = await mount(<EmptyRows title="No cases" body="No cases match these filters." />);
    expect(texts(r)).toEqual(["No cases", "No cases match these filters."]);
  });
});

// ---------------------------------------------------------------------------
// T9.0 hardening
import { Image } from "react-native";
import { AdminEvidenceRefresh, dedupeById } from "../../admin/AdminUI";
import { auditDetails, createEvidenceRetry } from "../../admin/adminViews";
import { EvidencePhoto } from "../EvidencePhoto";

describe("paging overlap is deduped by id", () => {
  it("page 1: A, B; page 2: B, C -> A, B, C (order kept, no duplicate keys)", async () => {
    type Row = { id: string };
    const fetch = jest.fn(async (offset: number): Promise<Result<AdminPage<Row>>> =>
      offset === 0 ? { ok: true, value: { rows: [{ id: "A" }, { id: "B" }], total: 3, nextOffset: 2 } } : { ok: true, value: { rows: [{ id: "B" }, { id: "C" }], total: 3, nextOffset: null } }
    );
    function Probe() {
      const p = useAdminPaged(fetch, "k");
      return (
        <>
          {p.rows.map((r) => (
            <Text key={r.id}>{`row:${r.id}`}</Text>
          ))}
          {p.rows.length ? <ListFooter p={p} /> : null}
        </>
      );
    }
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await mount(<Probe />);
    await press(r, "Load more");
    expect(texts(r).filter((t) => t.startsWith("row:"))).toEqual(["row:A", "row:B", "row:C"]);
    expect(errors.mock.calls.some((c) => /same key/i.test(String(c[0])))).toBe(false);
    errors.mockRestore();
    expect(dedupeById([{ id: 1 }, { id: 2 }, { id: 1 }, { id: 3 }])).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });
});

describe("console evidence: expired signed URL", () => {
  it("retry helper: only URLs on this page, once per cooldown", async () => {
    let t = 0;
    const reload = jest.fn(async () => undefined);
    const retry = createEvidenceRetry({ isShown: (u) => u === "https://signed/a", reload, now: () => t, cooldownMs: 60_000 });
    expect(await retry("https://signed/foreign")).toBe(false); // not on this page: never triggers a load
    expect(await retry("https://signed/a")).toBe(true);
    expect(await retry("https://signed/a")).toBe(false); // within the cooldown: no loop
    t += 60_000;
    expect(await retry("https://signed/a")).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  function DetailProbe({ load }: { load: () => Promise<Result<string>> }) {
    const s = useAdminLoad(load, "detail");
    if (s.phase !== "ready") return <Text>{s.phase}</Text>;
    return (
      <AdminEvidenceRefresh urls={[s.data]} refresh={s.refresh}>
        <EvidencePhoto uri={s.data} style={{ width: 10, height: 10 }} />
      </AdminEvidenceRefresh>
    );
  }
  const shown = (r: TestRenderer.ReactTestRenderer) => r.root.findAllByType(Image).map((i) => (i.props.source as { uri: string }).uri);
  const fail = async (r: TestRenderer.ReactTestRenderer) => {
    await act(async () => r.root.findByType(Image).props.onError());
    await act(async () => undefined);
  };

  it("a broken URL re-loads the detail once and shows the freshly signed URL", async () => {
    const urls = ["https://signed.example/x?token=old", "https://signed.example/x?token=new"];
    let i = 0;
    const load = jest.fn(async (): Promise<Result<string>> => ({ ok: true, value: urls[Math.min(i++, 1)] }));
    const r = await mount(<DetailProbe load={load} />);
    expect(shown(r)).toEqual([urls[0]]);
    await fail(r);
    expect(load).toHaveBeenCalledTimes(2);
    expect(shown(r)).toEqual([urls[1]]);
  });

  it("if the refreshed URL fails too, there is no loop: 'Photo unavailable'", async () => {
    let i = 0;
    const load = jest.fn(async (): Promise<Result<string>> => ({ ok: true, value: `https://signed.example/x?token=${i++}` }));
    const r = await mount(<DetailProbe load={load} />);
    await fail(r);
    await fail(r);
    expect(load).toHaveBeenCalledTimes(2); // initial + one refresh
    expect(shown(r)).toEqual([]);
    expect(r.root.find((n) => n.props.accessibilityLabel === "Photo unavailable")).toBeTruthy();
  });

  it("a refresh that finds the record gone/out of scope never shows foreign evidence", async () => {
    let i = 0;
    const load = jest.fn(async (): Promise<Result<string>> =>
      i++ === 0 ? { ok: true, value: "https://signed.example/mine" } : { ok: false, error: { code: "FORBIDDEN", message: "FORBIDDEN" } }
    );
    const r = await mount(<DetailProbe load={load} />);
    await fail(r);
    expect(texts(r)).toContain("failed");
    expect(shown(r)).toEqual([]);
  });
});

describe("audit amounts", () => {
  it("charge_cents renders as a parking charge in euros (integer cents in, no payment wording)", () => {
    expect(auditDetails({ code: "CHARGE_ISSUED", charge_cents: 6000 })).toBe("Parking charge issued · Parking charge · €60.00");
    expect(auditDetails({ charge_cents: null })).toBe("");
    expect(auditDetails({ charge_cents: 6000 })).not.toMatch(/cents|paid|revenue|collected/i);
  });
});
