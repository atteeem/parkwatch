// Parking tab UI flow (pure). One explicit state instead of a pile of booleans.
// Only the unfinished setup lives here; vehicles, the active session and history
// are domain data (AppContext). Nothing here is persisted: after a restart the
// tab opens at "Select area", or at the active session if one is running.

import { DIAL_MAX_MINUTES, DIAL_MIN_MINUTES, snapMinutes } from "./parkingDial";

export const DEFAULT_PARKING_MINUTES = 60;
export const DEFAULT_EXTENSION_MINUTES = 30;

export type SetupStep =
  | { step: "SELECT_AREA" }
  | { step: "AREA_DETAIL"; zoneId: string }
  | { step: "SELECT_VEHICLE"; zoneId: string; vehicleId?: string }
  | { step: "SELECT_DURATION"; zoneId: string; vehicleId: string; minutes: number }
  | { step: "CONFIRM"; zoneId: string; vehicleId: string; minutes: number };

export type ActiveStep = { step: "ACTIVE" } | { step: "EXTEND"; minutes: number } | { step: "END" };

export type ParkingFlowState = { setup: SetupStep; active: ActiveStep; minutes: number };

export const INITIAL_PARKING_FLOW: ParkingFlowState = {
  setup: { step: "SELECT_AREA" },
  active: { step: "ACTIVE" },
  minutes: DEFAULT_PARKING_MINUTES,
};

export type ParkingFlowAction =
  | { type: "SELECT_ZONE"; zoneId: string }
  | { type: "CONTINUE"; vehicleId?: string }
  | { type: "CHOOSE_VEHICLE"; vehicleId: string }
  | { type: "SET_MINUTES"; minutes: number }
  | { type: "BACK" }
  | { type: "STARTED" }
  | { type: "OPEN_EXTEND" }
  | { type: "OPEN_END" }
  | { type: "CLOSE_ACTIVE" }
  | { type: "ENDED" };

const minutesIn = (m: number) => snapMinutes(m, { min: DIAL_MIN_MINUTES, max: DIAL_MAX_MINUTES });

export function parkingFlowReducer(state: ParkingFlowState, a: ParkingFlowAction): ParkingFlowState {
  const s = state.setup;
  const setup = (next: SetupStep): ParkingFlowState => ({ ...state, setup: next });
  switch (a.type) {
    case "SELECT_ZONE":
      // Map markers and list rows both land here; later steps are not interrupted by a map tap.
      return s.step === "SELECT_AREA" || s.step === "AREA_DETAIL" ? setup({ step: "AREA_DETAIL", zoneId: a.zoneId }) : state;
    case "CONTINUE":
      if (s.step === "AREA_DETAIL") return setup({ step: "SELECT_VEHICLE", zoneId: s.zoneId, vehicleId: a.vehicleId });
      if (s.step === "SELECT_VEHICLE") {
        const vehicleId = a.vehicleId ?? s.vehicleId;
        return vehicleId ? setup({ step: "SELECT_DURATION", zoneId: s.zoneId, vehicleId, minutes: state.minutes }) : state;
      }
      if (s.step === "SELECT_DURATION") return setup({ step: "CONFIRM", zoneId: s.zoneId, vehicleId: s.vehicleId, minutes: s.minutes });
      return state;
    case "CHOOSE_VEHICLE":
      return s.step === "SELECT_VEHICLE" ? setup({ ...s, vehicleId: a.vehicleId }) : state;
    case "SET_MINUTES": {
      if (state.active.step === "EXTEND") return { ...state, active: { step: "EXTEND", minutes: minutesIn(a.minutes) } };
      if (s.step !== "SELECT_DURATION") return state;
      const minutes = minutesIn(a.minutes);
      return { ...state, minutes, setup: { ...s, minutes } };
    }
    case "BACK":
      if (state.active.step !== "ACTIVE") return { ...state, active: { step: "ACTIVE" } };
      if (s.step === "CONFIRM") return setup({ step: "SELECT_DURATION", zoneId: s.zoneId, vehicleId: s.vehicleId, minutes: s.minutes });
      if (s.step === "SELECT_DURATION") return setup({ step: "SELECT_VEHICLE", zoneId: s.zoneId, vehicleId: s.vehicleId });
      if (s.step === "SELECT_VEHICLE") return setup({ step: "AREA_DETAIL", zoneId: s.zoneId });
      if (s.step === "AREA_DETAIL") return setup({ step: "SELECT_AREA" });
      return state;
    case "STARTED":
      return { ...state, setup: { step: "SELECT_AREA" }, active: { step: "ACTIVE" } };
    case "OPEN_EXTEND":
      return { ...state, active: { step: "EXTEND", minutes: DEFAULT_EXTENSION_MINUTES } };
    case "OPEN_END":
      return { ...state, active: { step: "END" } };
    case "CLOSE_ACTIVE":
      return { ...state, active: { step: "ACTIVE" } };
    case "ENDED":
      return { ...state, setup: { step: "SELECT_AREA" }, active: { step: "ACTIVE" } };
  }
}

/** True when a hardware/back gesture should step back inside the sheet instead of leaving the tab. */
export function canGoBackInFlow(state: ParkingFlowState, hasActive: boolean): boolean {
  return hasActive ? state.active.step !== "ACTIVE" : state.setup.step !== "SELECT_AREA";
}

/** The zone highlighted on the map for the current state. */
export function highlightedZone(state: ParkingFlowState, activeZoneId: string | undefined): string | undefined {
  if (activeZoneId) return activeZoneId;
  return state.setup.step === "SELECT_AREA" ? undefined : state.setup.zoneId;
}
