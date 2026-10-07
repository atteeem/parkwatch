-- ============================================================================
-- T8.7: officer evidence types say what the photo shows.
--
-- The officer captures FRONT / LICENSE PLATE / PARKING SIGN / REAR. The old
-- values VEHICLE_OVERVIEW and VIOLATION_CONTEXT were always used for the front
-- and rear photos, so this is a pure rename:
--
--   VEHICLE_OVERVIEW  -> VEHICLE_FRONT
--   VIOLATION_CONTEXT -> VEHICLE_REAR
--
-- ALTER TYPE ... RENAME VALUE changes the label in place: every existing
-- officer_evidence row keeps its value (now shown with the new label), the
-- unique (inspection_id, evidence_type) constraint and the "four distinct
-- types" completion check are unaffected, and add_officer_evidence() (typed
-- public.officer_evidence_type) accepts the new labels. No function body,
-- policy or storage path refers to the old labels. Storage object names of
-- existing photos are not rewritten (they are opaque paths; the row's
-- evidence_type is the source of truth).
--
-- Clients must use the new labels after this migration (app T8.7+).
-- ============================================================================

alter type public.officer_evidence_type rename value 'VEHICLE_OVERVIEW' to 'VEHICLE_FRONT';
alter type public.officer_evidence_type rename value 'VIOLATION_CONTEXT' to 'VEHICLE_REAR';
