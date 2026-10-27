// T9.5 reporting moderation: wording, validation, server-answer mapping, the
// RPC client and the staff panel. The database rules themselves (strikes,
// expiry, authorization, enforcement) are covered by scripts/verify-t95.mjs.
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Modal, Text, TextInput } from "react-native";
import * as fs from "fs";
import * as path from "path";
import { ok } from "../../domain";
import {
  citizenRestrictionCopy,
  CitizenModeration,
  ModerationApi,
  newModerationRequestId,
  restrictConfirmCopy,
  restrictInputError,
  revokeConfirmCopy,
  revokeInputError,
  StaffModeration,
} from "../moderationTypes";
import { citizenModerationFrom, createModerationApi, staffModerationFrom } from "../../backend/moderation/moderationClient";
import { mapRpcError } from "../../backend/operations/rpcErrors";
import { describeDomainError } from "../../presentation/errors";
import { MODERATION_PANEL_COPY, ModerationPanel } from "../ModerationPanel";
import { RestrictionNotice } from "../citizenModeration";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const staff = (over: Partial<StaffModeration> = {}): StaffModeration => ({
  status: "ACTIVE",
  strikes: 0,
  maxStrikes: 3,
  citizenRef: "C-1A2B3C4D",
  cycle: 1,
  lifetimeStrikes: 0,
  history: [],
  ...over,
});

describe("wording", () => {
  it("restriction confirmation names the strike; the third strike warns explicitly", () => {
    expect(restrictConfirmCopy({ strikes: 0 })).toMatchObject({ title: "Restrict this user's reporting access for 30 days?", third: false });
    expect(restrictConfirmCopy({ strikes: 0 }).body).toMatch(/^This will be strike 1 of 3\./);
    expect(restrictConfirmCopy({ strikes: 1 }).body).toMatch(/^This will be strike 2 of 3\./);
    const third = restrictConfirmCopy({ strikes: 2 });
    expect(third.third).toBe(true);
    expect(third.body).toContain("This will be strike 3 of 3.");
    expect(third.body).toContain("This is the user's third restriction. Confirming will indefinitely restrict their reporting access until an officer or administrator restores it.");
  });
  it("revocation wording: a lifted temporary restriction still counts; restoring keeps lifetime strikes", () => {
    expect(revokeConfirmCopy({ status: "TEMPORARILY_RESTRICTED" }).body).toMatch(/still counts as a strike/);
    expect(revokeConfirmCopy({ status: "INDEFINITELY_RESTRICTED" }).body).toMatch(/new strike count \(lifetime strikes are kept\)/);
  });
  it("citizen wording: professional, with expiry, strikes and the warning; no penalty language", () => {
    const temp = citizenRestrictionCopy({ status: "TEMPORARILY_RESTRICTED", restrictedUntil: "2026-11-26T10:00:00Z", reason: "SPAM_INVALID", strikes: 2, maxStrikes: 3 })!;
    expect(temp.title).toBe("Reporting temporarily restricted");
    expect(temp.lines.join(" ")).toMatch(/until 26 Nov 2026/);
    expect(temp.lines.join(" ")).toMatch(/2 of 3/);
    expect(temp.lines.join(" ")).toMatch(/indefinite restriction/);
    const perm = citizenRestrictionCopy({ status: "INDEFINITELY_RESTRICTED", strikes: 3, maxStrikes: 3 })!;
    expect(perm.title).toBe("Reporting access restricted");
    expect(perm.lines.join(" ")).toMatch(/unless the restriction is reviewed and lifted/);
    for (const t of [temp, perm]) expect([t.title, ...t.lines].join(" ")).not.toMatch(/fine|penalt|crime|criminal|offen[cs]e|police|banned|sanction/i);
    expect(citizenRestrictionCopy({ status: "ACTIVE", strikes: 1, maxStrikes: 3 })).toBeNull();
  });
  it("server refusals have plain messages", () => {
    expect(describeDomainError({ code: "REPORTING_RESTRICTED" }).message).toMatch(/Reporting is restricted for your account/);
    expect(mapRpcError({ code: "P0001", message: "REPORTING_RESTRICTED: Reporting is restricted for this account." }).code).toBe("REPORTING_RESTRICTED");
    expect(mapRpcError({ code: "P0001", message: "ALREADY_RESTRICTED: x" }).code).toBe("ALREADY_RESTRICTED");
  });
});

describe("validation (the server enforces the same)", () => {
  it("a reason is required; 'Other' needs a note; revocation needs a reason", () => {
    expect(restrictInputError(null, "")).toBe("Choose a reason.");
    expect(restrictInputError("OTHER", "  ")).toBe("Describe the reason in a note.");
    expect(restrictInputError("OTHER", "Uploaded a selfie")).toBeNull();
    expect(restrictInputError("SPAM_INVALID", "")).toBeNull();
    expect(revokeInputError(" ")).toMatch(/Give a reason/);
    expect(revokeInputError("Appeal accepted")).toBeNull();
  });
  it("request ids are unique and match the server's format", () => {
    const a = newModerationRequestId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,80}$/);
    expect(newModerationRequestId()).not.toBe(a);
  });
});

describe("mapping server answers", () => {
  it("the citizen mapping can never carry notes, staff names or history", () => {
    const m = citizenModerationFrom({ status: "TEMPORARILY_RESTRICTED", restricted_until: "2026-11-26T10:00:00Z", reason: "FALSE_REPORT", strikes: 1, max_strikes: 3, internal_note: "secret", actor_name: "Olli", history: [{}] });
    expect(m).toEqual({ status: "TEMPORARILY_RESTRICTED", restrictedUntil: "2026-11-26T10:00:00Z", reason: "FALSE_REPORT", strikes: 1, maxStrikes: 3 });
  });
  it("staff mapping keeps history with notes, revocation links and cycles", () => {
    const s = staffModerationFrom({
      status: "ACTIVE", strikes: 0, max_strikes: 3, citizen_ref: "C-1", cycle: 2, lifetime_strikes: 3,
      history: [{ id: "r1", type: "RESTRICTION_REVOKED", created_at: "2026-10-27T10:00:00Z", actor_role: "ADMIN", actor_name: "Aaro", same_organization: true, cycle: 1, indefinite: false, revokes_action_id: "i3", revoke_reason: "Appeal accepted" }],
    });
    expect(s).toMatchObject({ cycle: 2, lifetimeStrikes: 3, history: [{ type: "RESTRICTION_REVOKED", actorRole: "ADMIN", revokesActionId: "i3", revokeReason: "Appeal accepted" }] });
    expect(staffModerationFrom({ status: "WHATEVER" }).status).toBe("ACTIVE");
  });
  it("the client calls the server functions with the case id only (never a user id or a role)", async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const client = { rpc: async (fn: string, args: Record<string, unknown>) => (calls.push({ fn, args }), { data: { status: "ACTIVE", strikes: 0, max_strikes: 3, history: [] }, error: null, status: 200 }) };
    const api = createModerationApi(client as never);
    await api.getMine();
    await api.getForCase("case-1");
    await api.restrict("case-1", "SPAM_INVALID", null, "mod-abcdef123456");
    await api.revoke("case-1", "act-1", "Reviewed", "mod-abcdef654321");
    expect(calls.map((c) => c.fn)).toEqual(["get_my_moderation", "get_reporter_moderation", "restrict_reporter", "revoke_reporter_restriction"]);
    for (const c of calls) expect(Object.keys(c.args).some((k) => /user|role|citizen/.test(k))).toBe(false);
  });
});

describe("staff panel", () => {
  function fakeApi(initial: StaffModeration, onRestrict?: (args: unknown[]) => StaffModeration) {
    const calls: { fn: string; args: unknown[] }[] = [];
    let state = initial;
    const api: ModerationApi = {
      getMine: async () => ok({ status: "ACTIVE", strikes: 0, maxStrikes: 3 }),
      getForCase: async () => (calls.push({ fn: "get", args: [] }), ok(state)),
      restrict: async (...args) => {
        calls.push({ fn: "restrict", args });
        state = onRestrict ? onRestrict(args) : { ...state, status: "TEMPORARILY_RESTRICTED", strikes: state.strikes + 1, activeActionId: "a1", restrictedUntil: "2026-11-26T10:00:00Z" };
        return ok({ ...state, changed: true });
      },
      revoke: async (...args) => {
        calls.push({ fn: "revoke", args });
        state = { ...state, status: "ACTIVE", activeActionId: undefined };
        return ok({ ...state, changed: true });
      },
    };
    return { api, calls };
  }
  const texts = (r: TestRenderer.ReactTestRenderer) => r.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
  const press = async (r: TestRenderer.ReactTestRenderer, label: string) => {
    const hit = r.root.findAll((n) => typeof n.props.onPress === "function" && (n.props.accessibilityLabel === label || n.findAllByType(Text).some((t) => [t.props.children].flat().join("") === label))).pop();
    if (!hit) throw new Error(`no ${label}`);
    await act(async () => {
      await hit.props.onPress();
    });
  };
  const render = async (api: ModerationApi) => {
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<ModerationPanel api={api} caseId="case-1" />);
    });
    return r;
  };

  it("shows status and strikes 0/3; restricting needs a reason and confirms 'strike 1 of 3'", async () => {
    const { api, calls } = fakeApi(staff());
    const r = await render(api);
    expect(texts(r)).toContain("Reporting allowed");
    expect(texts(r).join(" ")).toMatch(/Strikes 0\/3/);
    await press(r, MODERATION_PANEL_COPY.restrict);
    expect(r.root.findByType(Modal).props.visible).toBe(true);
    expect(texts(r).join(" ")).toMatch(/This will be strike 1 of 3/);
    await press(r, MODERATION_PANEL_COPY.confirmRestrict);
    expect(texts(r)).toContain("Choose a reason.");
    expect(calls.filter((c) => c.fn === "restrict")).toHaveLength(0);
    await press(r, "Spam / repeated invalid reports");
    await press(r, MODERATION_PANEL_COPY.confirmRestrict);
    expect(calls.filter((c) => c.fn === "restrict")).toHaveLength(1);
    expect(calls.find((c) => c.fn === "restrict")!.args.slice(0, 3)).toEqual(["case-1", "SPAM_INVALID", null]);
    expect(texts(r)).toContain("Reporting restricted (30 days)");
  });

  it("'Other' requires a note; the note is sent; double press sends ONE request", async () => {
    let resolve!: () => void;
    const gate = new Promise<void>((res) => (resolve = res));
    const { api, calls } = fakeApi(staff());
    const slow: ModerationApi = { ...api, restrict: async (...a) => (calls.push({ fn: "restrict-start", args: a }), await gate, api.restrict(...a)) };
    const r = await render(slow);
    await press(r, MODERATION_PANEL_COPY.restrict);
    await press(r, "Other");
    await press(r, MODERATION_PANEL_COPY.confirmRestrict);
    expect(texts(r)).toContain("Describe the reason in a note.");
    act(() => r.root.findByType(TextInput).props.onChangeText("Uploaded unrelated photos"));
    const btn = r.root.findAll((n) => typeof n.props.onPress === "function" && n.findAllByType(Text).some((t) => t.props.children === MODERATION_PANEL_COPY.confirmRestrict)).pop()!;
    act(() => {
      void btn.props.onPress();
      void btn.props.onPress();
    });
    await act(async () => resolve());
    expect(calls.filter((c) => c.fn === "restrict-start")).toHaveLength(1);
    expect(calls.find((c) => c.fn === "restrict-start")!.args[2]).toBe("Uploaded unrelated photos");
  });

  it("third strike: explicit indefinite-restriction warning before confirming", async () => {
    const { api } = fakeApi(staff({ strikes: 2, lifetimeStrikes: 2 }));
    const r = await render(api);
    await press(r, MODERATION_PANEL_COPY.restrictThird);
    expect(texts(r).join(" ")).toMatch(/This is the user's third restriction\. Confirming will indefinitely restrict their reporting access until an officer or administrator restores it\./);
  });

  it("restricted: Lift / Restore needs a reason; history shows who, why, when; notes are staff-visible", async () => {
    const { api, calls } = fakeApi(
      staff({
        status: "INDEFINITELY_RESTRICTED",
        strikes: 3,
        lifetimeStrikes: 3,
        activeActionId: "i3",
        history: [{ id: "i3", type: "RESTRICTION_ISSUED", createdAt: "2026-10-20T10:00:00Z", actorRole: "OFFICER", actorName: "Olli Officer", sameOrganization: true, reason: "MANIPULATED_EVIDENCE", internalNote: "Edited plate", cycle: 1, strikeInCycle: 3, lifetimeStrike: 3, indefinite: true }],
      })
    );
    const r = await render(api);
    const all = texts(r).join(" ");
    expect(all).toMatch(/Reporting restricted indefinitely/);
    expect(all).toMatch(/Indefinite restriction \(strike 3 of 3\)/);
    expect(all).toMatch(/Olli Officer \(Officer\)/);
    expect(all).toMatch(/Reason: Manipulated evidence/);
    expect(all).toMatch(/Note: Edited plate/);
    await press(r, MODERATION_PANEL_COPY.restore);
    await press(r, MODERATION_PANEL_COPY.confirmRestore);
    expect(texts(r)).toContain("Give a reason for lifting the restriction.");
    act(() => r.root.findByType(TextInput).props.onChangeText("Appeal accepted"));
    await press(r, MODERATION_PANEL_COPY.confirmRestore);
    expect(calls.find((c) => c.fn === "revoke")!.args.slice(0, 3)).toEqual(["case-1", "i3", "Appeal accepted"]);
    expect(texts(r)).toContain("Reporting allowed");
  });

  it("ALREADY_RESTRICTED from the server (another officer was faster) reloads the status", async () => {
    const { api, calls } = fakeApi(staff());
    const racing: ModerationApi = { ...api, restrict: async () => ({ ok: false, error: { code: "ALREADY_RESTRICTED", message: "ALREADY_RESTRICTED" } }) };
    const r = await render(racing);
    await press(r, MODERATION_PANEL_COPY.restrict);
    await press(r, "Spam / repeated invalid reports");
    await press(r, MODERATION_PANEL_COPY.confirmRestrict);
    expect(texts(r).join(" ")).toMatch(/already restricted/);
    expect(calls.filter((c) => c.fn === "get").length).toBeGreaterThanOrEqual(2);
  });
});

describe("citizen side", () => {
  it("restriction notice renders the professional copy", () => {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<RestrictionNotice m={{ status: "INDEFINITELY_RESTRICTED", strikes: 3, maxStrikes: 3 } as CitizenModeration} />);
    });
    expect(r.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""))).toContain("Reporting access restricted");
  });
  it("Report opens the restriction screen instead of the camera for restricted accounts; unknown status never blocks", () => {
    const src = read("app/user/report/photos.tsx");
    expect(src).toMatch(/if \(mod\.data && isRestricted\(mod\.data\)\)/);
    expect(src).toMatch(/<RestrictionNotice m=\{mod\.data\} \/>/);
  });
  it("the citizen screen reads only get_my_moderation (no staff function, no notes)", () => {
    const src = read("app/user/moderation.tsx") + read("src/moderation/citizenModeration.tsx");
    expect(src).not.toMatch(/getForCase|internalNote|revokeReason|actorName|history/);
  });
  it("Profile links to Reporting status (server mode only)", () => {
    expect(read("app/user/profile.tsx")).toMatch(/title="Reporting status"[\s\S]*router\.push\("\/user\/moderation"\)/);
  });
});

describe("wiring and boundaries", () => {
  it("officer case screen and console case page show the panel (server-backed only)", () => {
    expect(read("app/officer/report-details.tsx")).toMatch(/\{moderation \? <ModerationPanel api=\{moderation\} caseId=\{c\.id\} \/> : null\}/);
    expect(read("app/admin/cases/[id].tsx")).toMatch(/<ModerationPanel api=\{moderation\} caseId=\{load\.data\.id\} \/>/);
  });
  it("only AppContext imports the moderation backend client", () => {
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
        const p = `${d}/${e.name}`;
        if (e.isDirectory()) {
          if (!/node_modules|__tests__|\.expo/.test(e.name)) walk(p);
        } else if (/\.tsx?$/.test(e.name) && /backend\/moderation\/moderationClient/.test(fs.readFileSync(path.join(ROOT, p), "utf8"))) hits.push(p);
      }
    };
    walk("app");
    walk("src");
    expect(hits).toEqual(["src/context/AppContext.tsx"]);
  });
});
