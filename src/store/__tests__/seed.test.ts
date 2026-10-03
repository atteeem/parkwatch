import { calculateBalances, getCitizenOutcomeForEnforcementOutcome, getRewardState } from "../../domain";
import { VIOLATION_TYPES } from "../../data/types";
import { buildSeedState } from "../seed";
import { DEV_CITIZEN_ID } from "../session";
import { NOW } from "./helpers";

const s = buildSeedState(NOW);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe("seed data consistency", () => {
  it("every report has exactly one case and they point at each other", () => {
    expect(s.cases).toHaveLength(s.reports.length);
    for (const r of s.reports) {
      const c = s.cases.filter((x) => x.reportId === r.id);
      expect(c).toHaveLength(1);
      expect(r.caseId).toBe(c[0].id);
    }
  });

  it("completed cases have outcomes and completed inspections", () => {
    for (const c of s.cases.filter((x) => x.status === "COMPLETED")) {
      expect(c.outcome).toBeDefined();
      expect(s.inspections[c.id]?.completedAt).toBe(c.completedAt);
      expect(s.inspections[c.id]?.outcome?.code).toBe(c.outcome?.code);
    }
    for (const c of s.cases.filter((x) => x.status !== "COMPLETED")) expect(c.outcome).toBeUndefined();
  });

  it("citizen statuses agree with resolved outcomes; open cases stay UNDER_REVIEW", () => {
    for (const r of s.reports) {
      const c = s.cases.find((x) => x.reportId === r.id)!;
      if (!c.outcome) {
        expect(r.status).toBe("UNDER_REVIEW");
        continue;
      }
      const mapping = getCitizenOutcomeForEnforcementOutcome(c.outcome.code).citizenStatus;
      expect(r.status).toBe(mapping.resolution === "RESOLVED" ? mapping.status : "UNDER_REVIEW");
    }
  });

  it("one reward lifecycle per report, consistent with its status", () => {
    for (const r of s.reports) {
      const state = getRewardState(s.ledger, r.id);
      const expected = { UNDER_REVIEW: "PENDING", VERIFIED: "AVAILABLE", REJECTED: "VOID" }[r.status];
      expect(state).toBe(expected);
      expect(s.ledger.filter((e) => e.type === "REWARD_PENDING" && e.reportId === r.id)).toHaveLength(1);
    }
  });

  it("reproduces the Figma wallet: €45 available, €10 pending, €55 paid out", () => {
    expect(calculateBalances(s.ledger, DEV_CITIZEN_ID)).toEqual({
      availableCents: 4500,
      pendingCents: 1000,
      paidOutCents: 5500,
      withdrawalsInFlightCents: 0,
    });
  });

  it("uses canonical violation ids and ISO timestamps", () => {
    const ids = VIOLATION_TYPES.map((v) => v.id as string);
    for (const r of s.reports) {
      expect(ids).toContain(r.violationId);
      expect(r.submittedAt).toMatch(ISO);
      expect(r.observedAt).toMatch(ISO);
    }
    for (const n of s.notifications) expect(n.createdAt).toMatch(ISO);
    for (const c of s.cases) Object.values(c.statusTimestamps).forEach((t) => expect(t).toMatch(ISO));
  });

  it("covers every officer status shown in the designs, with the case in INSPECTION having an inspection", () => {
    const statuses = new Set(s.cases.map((c) => c.status));
    for (const st of ["NEW", "ASSIGNED", "EN_ROUTE", "ON_SITE", "INSPECTION", "COMPLETED"]) expect(statuses).toContain(st);
    for (const c of s.cases.filter((x) => x.status === "INSPECTION")) expect(s.inspections[c.id]).toBeDefined();
  });

  it("seed records are marked SEED, with stable account ids (never display names) as actors", () => {
    const events = [...s.reports.flatMap((r) => r.events), ...s.cases.flatMap((c) => c.events)];
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.source === "SEED")).toBe(true);
    expect(events.every((e) => /^(citizen|officer)-[a-z]+$/.test(e.actor.accountId))).toBe(true);
    expect(events.some((e) => e.actor.accountId === "officer-demo")).toBe(true);
    expect(s.reports.flatMap((r) => r.evidence).every((e) => e.captureSource === "SEED")).toBe(true);
    expect(Object.values(s.inspections).flatMap((i) => Object.values(i.officerEvidence)).every((e) => e?.captureSource === "SEED")).toBe(true);
  });

  it("seed reports carry jurisdiction, plate value objects and no fake server time", () => {
    for (const r of s.reports) {
      expect(r.jurisdictionId).toBe("helsinki-demo");
      expect(r.vehicle?.plate.normalized).toBe(r.vehicle?.plate.raw.replace("-", ""));
      expect(r.receivedAt).toBeUndefined();
    }
  });

  it("new reports are numbered after the seed", () => {
    const max = Math.max(...s.reports.map((r) => Number(r.id)));
    expect(s.nextReportNumber).toBeGreaterThan(max);
  });
});
