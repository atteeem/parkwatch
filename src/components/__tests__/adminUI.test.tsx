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
