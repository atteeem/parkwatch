# ParkWatch investor demo (development/demo builds only)

One phone, both sides of the product, one report object end to end.

## Before the demo

1. Citizen app → **Profile** → scroll to **Demo tools** (dev builds only) → **Reset demo data** → Reset.
2. Allow camera and location when asked.

After a reset the state is always the same:

| | Value |
|---|---|
| Citizen | Mika Salo (shown to officers as "Mika S.") |
| Officer | Officer Mikko Virtanen |
| Wallet | €45.00 available · €10.00 pending (2 reports under review) · €55.00 paid out (history) |
| Citizen reports | 6 (#12564 XKR-418 and #12566 ABC-123 under review, 3 verified, 1 rejected) |
| Officer queue | 9 open cases (5 new, 4 assigned to the officer) |
| Next new report id | **#12600** |

## The canonical demo report

Every screen below shows the SAME stored report; nothing is copied per screen.

| Field | Value | Source |
|---|---|---|
| Report ID | #12600 | next id after reset |
| Plate / vehicle | GHC-789 · Volvo XC60 · Dark Grey | the MVP's single configured mock plate (`MVP_MOCK_DETECTED_VEHICLE`); no plate recognition yet |
| Evidence | Front, Side, Rear taken with the camera | your phone |
| Violation | e.g. "No parking zone" | your choice |
| Location | address you enter + phone GPS position | your phone |
| Reward | €5.00 (pending → available after a charge) | config |
| Parking charge | €60.00 | config |

## Script

**Citizen** — Report tab → Front/Side/Rear photos → violation → address (GPS attaches automatically) → Review → Submit.
Shown on: Review, Report Submitted (#12600), My Reports (Under Review, €5 estimated).

**Switch** — Profile → Demo tools → *Switch to Officer app*.

**Officer** — Queue (New) shows GHC-789 #12600 → View Case → Accept Case → En Route → Start On-site Inspection →
confirm the four checks (Confirm Plate for the plate row) → take the four officer photos → Continue → *Issue parking charge* → Submit result.
Shown on: Queue, Report Details, En Route, Inspection, Inspection Result, Inspection Completed (€60.00, 4 / 4).

**Switch** — Officer Profile → Demo tools → *Switch to Citizen app*.

**Citizen** — My Reports: #12600 Verified, €5.00 Rewarded · Notifications: "Report verified … a parking charge has been issued" ·
Earnings: available €45.00 → €50.00.

## What is simulated (say it if asked)

- The plate comes from one configured mock value; "Confirm Plate" is the officer's manual confirmation.
- No server: data lives on the phone. Times come from the phone clock.
- No real parking operator, enforcement API, bank payout or identity check.
- Seeded history reports show neutral "Demo photo" tiles instead of real photos.

## Parking (simulated, optional)

After a reset: vehicles JSK-306 (Volvo XC60) and HOF-782 (Porsche Taycan), no active parking, no history.

Parking tab → **Start Parking** → pick vehicle, zone (B2 / A1 / C4) and duration (30 min … 4 h or Custom) → Start Parking.
The active card counts down from the chosen end time; **Extend** adds time; **End Parking** moves it to **Parking History**.
**My Vehicles** → Add Vehicle (plate required; "ABC-123" and "abc 123" are the same vehicle).

Demo rate €2.00/hour, computed on this phone. No parking operator is contacted and nothing is paid.
