// Unsent report draft persistence and recovery (server-backed mode), and that
// the local demo is unchanged. ReportProvider with an in-memory storage and
// mocked auth/app contexts.
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createMemoryStorage } from "../../store/persistence";
import { draftStorageKey, hasDraftContent, loadPersistedDraft, resumeRoute } from "../../presentation/draftPersistence";
import { completeDraft } from "../../domain/__tests__/fixtures";

let mockAuth: { mode: string; status: string; user?: { id: string } } = { mode: "BACKEND", status: "authenticated", user: { id: "user-a" } };
let mockDataSource = "BACKEND";
const mockAbandon = jest.fn(async (_paths: readonly string[]) => undefined);
jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ state: mockAuth }) }));
jest.mock("../AppContext", () => ({ useApp: () => ({ dataSource: mockDataSource, abandonSubmission: mockAbandon }) }));

// eslint-disable-next-line import/first
import { ReportProvider, useReportDraft } from "../ReportContext";

type Ctx = ReturnType<typeof useReportDraft>;
const flush = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0));
});

function mount(storage: ReturnType<typeof createMemoryStorage>) {
  const ref: { current: Ctx | null } = { current: null };
  const Probe = () => {
    ref.current = useReportDraft();
    return null;
  };
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <ReportProvider storage={storage}>
        <Probe />
      </ReportProvider>
    );
  });
  return { ctx: () => ref.current!, renderer };
}

const NOW = "2026-10-05T10:00:00.000Z";

beforeEach(() => {
  mockAuth = { mode: "BACKEND", status: "authenticated", user: { id: "user-a" } };
  mockDataSource = "BACKEND";
  mockAbandon.mockClear();
});

describe("server mode: unsent draft persistence", () => {
  it("persists the draft (same id, photos, inputs) as soon as it has content", async () => {
    const storage = createMemoryStorage();
    const { ctx } = mount(storage);
    await flush();
    const id = ctx().draft.draftId;
    act(() => ctx().capturePhoto("FRONT", "file:///front.jpg", NOW));
    act(() => ctx().setViolation("no-parking"));
    act(() => ctx().setNotes("blocking the exit"));
    await flush();
    const rec = await loadPersistedDraft(storage, "user-a");
    expect(rec?.draft.draftId).toBe(id);
    expect(rec?.draft.photos.FRONT?.uri).toBe("file:///front.jpg");
    expect(rec?.draft).toMatchObject({ violationId: "no-parking", notes: "blocking the exit" });
  });

  it("after an app restart the same draft (same submission id) and upload progress are recovered", async () => {
    const storage = createMemoryStorage();
    const first = mount(storage);
    await flush();
    const id = first.ctx().draft.draftId;
    act(() => first.ctx().capturePhoto("FRONT", "file:///front.jpg", NOW));
    act(() => first.ctx().recordUpload("user-a/x/front.jpg"));
    await flush();
    act(() => first.renderer.unmount()); // the app is closed

    const second = mount(storage);
    await flush();
    expect(second.ctx().unsentDraft).toMatchObject({ route: "/user/report/photos" });
    expect(second.ctx().draft.draftId).not.toBe(id); // nothing restored until the user chooses
    let route = "";
    act(() => {
      route = second.ctx().resumeDraft();
    });
    expect(route).toBe("/user/report/photos");
    expect(second.ctx().draft.draftId).toBe(id);
    expect(second.ctx().uploadedPaths).toEqual(["user-a/x/front.jpg"]);
  });

  it("starting a new report while an unsent one exists continues it instead of replacing it", async () => {
    const storage = createMemoryStorage();
    const first = mount(storage);
    await flush();
    const id = first.ctx().draft.draftId;
    act(() => first.ctx().setViolation("no-parking"));
    await flush();
    act(() => first.renderer.unmount());
    const second = mount(storage);
    await flush();
    act(() => second.ctx().startNewReport());
    expect(second.ctx().draft.draftId).toBe(id);
    // and in the same session, leaving and re-entering the wizard keeps it too
    act(() => second.ctx().startNewReport());
    expect(second.ctx().draft.draftId).toBe(id);
  });

  it("a failed upload/submit does not clear the draft", async () => {
    const storage = createMemoryStorage();
    const { ctx } = mount(storage);
    await flush();
    act(() => ctx().capturePhoto("FRONT", "file:///front.jpg", NOW));
    act(() => ctx().recordUpload("user-a/d/front.jpg"));
    await flush();
    // (submit failed: markSubmitted is never called)
    const rec = await loadPersistedDraft(storage, "user-a");
    expect(rec?.uploaded).toEqual(["user-a/d/front.jpg"]);
  });

  it("a successful submission clears the stored draft", async () => {
    const storage = createMemoryStorage();
    const { ctx } = mount(storage);
    await flush();
    act(() => ctx().setViolation("no-parking"));
    await flush();
    expect(await storage.getItem(draftStorageKey("user-a"))).not.toBeNull();
    act(() => ctx().markSubmitted("100001"));
    await flush();
    expect(await storage.getItem(draftStorageKey("user-a"))).toBeNull();
    expect(ctx().unsentDraft).toBeNull();
  });

  it("discard clears the draft and cleans up its uploads", async () => {
    const storage = createMemoryStorage();
    const first = mount(storage);
    await flush();
    act(() => first.ctx().setViolation("no-parking"));
    act(() => first.ctx().recordUpload("user-a/d/front.jpg"));
    await flush();
    act(() => first.renderer.unmount());
    const second = mount(storage);
    await flush();
    await act(async () => {
      await second.ctx().discardDraft();
    });
    expect(await storage.getItem(draftStorageKey("user-a"))).toBeNull();
    expect(mockAbandon).toHaveBeenCalledWith(["user-a/d/front.jpg"]);
    expect(second.ctx().unsentDraft).toBeNull();
  });

  it("session expiry keeps the stored draft; signing in again as the same user recovers it", async () => {
    const storage = createMemoryStorage();
    const m = mount(storage);
    await flush();
    const id = m.ctx().draft.draftId;
    act(() => m.ctx().setViolation("no-parking"));
    await flush();
    mockAuth = { mode: "BACKEND", status: "unauthenticated" };
    m.renderer.update(
      <ReportProvider storage={storage}>
        <Probe2 onCtx={() => undefined} />
      </ReportProvider>
    );
    await flush();
    expect(await storage.getItem(draftStorageKey("user-a"))).not.toBeNull();
    mockAuth = { mode: "BACKEND", status: "authenticated", user: { id: "user-a" } };
    const again = mount(storage);
    await flush();
    act(() => {
      again.ctx().resumeDraft();
    });
    expect(again.ctx().draft.draftId).toBe(id);
  });

  it("another account never sees (or overwrites) the first account's draft", async () => {
    const storage = createMemoryStorage();
    const a = mount(storage);
    await flush();
    act(() => a.ctx().setViolation("no-parking"));
    await flush();
    act(() => a.renderer.unmount());
    mockAuth = { mode: "BACKEND", status: "authenticated", user: { id: "user-b" } };
    const b = mount(storage);
    await flush();
    expect(b.ctx().unsentDraft).toBeNull();
    expect(b.ctx().draft.violationId).toBeUndefined();
    expect(await loadPersistedDraft(storage, "user-a")).not.toBeNull();
  });
});

describe("local demo is unchanged", () => {
  it("nothing is persisted and every new report gets a fresh draft", async () => {
    mockAuth = { mode: "LOCAL_DEMO", status: "backend-not-configured" };
    mockDataSource = "LOCAL_DEMO";
    const storage = createMemoryStorage();
    const { ctx } = mount(storage);
    await flush();
    act(() => ctx().setViolation("no-parking"));
    await flush();
    expect(Object.keys(storage.data)).toEqual([]);
    expect(ctx().unsentDraft).toBeNull();
    const id = ctx().draft.draftId;
    act(() => ctx().startNewReport());
    expect(ctx().draft.draftId).not.toBe(id);
  });
});

describe("draft persistence helpers", () => {
  it("resume route is the first step that still needs input", () => {
    const d = completeDraft("d1");
    expect(resumeRoute(d)).toBe("/user/report/review");
    expect(resumeRoute({ ...d, violationId: undefined })).toBe("/user/report/select-violation");
    expect(resumeRoute({ ...d, location: { address: " " } })).toBe("/user/report/add-details");
    expect(resumeRoute({ ...d, photos: {} })).toBe("/user/report/photos");
  });

  it("an empty wizard is not a draft; malformed or other-user records are never restored", async () => {
    expect(hasDraftContent({ ...completeDraft("d"), photos: {}, violationId: undefined, location: { address: "" }, notes: "", attachments: [] })).toBe(false);
    const storage = createMemoryStorage({
      [draftStorageKey("user-a")]: JSON.stringify({ version: 1, userId: "user-b", draft: completeDraft("d"), uploaded: [], savedAt: NOW }),
    });
    expect(await loadPersistedDraft(storage, "user-a")).toBeNull();
    await storage.setItem(draftStorageKey("user-a"), "{not json");
    expect(await loadPersistedDraft(storage, "user-a")).toBeNull();
    await storage.setItem(draftStorageKey("user-a"), JSON.stringify({ version: 1, userId: "user-a", draft: { ...completeDraft("bad id!") }, uploaded: [], savedAt: NOW }));
    expect(await loadPersistedDraft(storage, "user-a")).toBeNull();
  });
});

function Probe2({ onCtx }: { onCtx: (c: Ctx) => void }) {
  onCtx(useReportDraft());
  return null;
}
