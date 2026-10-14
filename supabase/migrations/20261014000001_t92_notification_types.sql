-- ============================================================================
-- T9.2 (1/3): new in-app notification types for supervisor case assignment.
--
-- Kept in its own migration: a new enum value cannot be used in the same
-- transaction that adds it, and the next migrations use these values.
--
--   CASE_ASSIGNED            -> the officer a supervisor assigned the case to
--                               (in-app + push, see 20261014000002)
--   CASE_ASSIGNMENT_REMOVED  -> the previous officer after a reassignment or a
--                               return to the queue (in-app only, never pushed)
-- ============================================================================

alter type public.notification_type add value if not exists 'CASE_ASSIGNED';
alter type public.notification_type add value if not exists 'CASE_ASSIGNMENT_REMOVED';
