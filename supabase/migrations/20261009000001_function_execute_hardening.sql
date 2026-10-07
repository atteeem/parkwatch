-- ============================================================================
-- T8.5: function EXECUTE hardening (found on the real development project).
--
-- On Supabase, new functions in `public` are executable by PUBLIC, anon and
-- authenticated unless revoked. Earlier migrations revoked this for the app's
-- RPCs but not for six SECURITY DEFINER helpers, so anonymous callers could
-- invoke them (they returned false for anon, so no data leaked, but definer
-- functions bypass RLS internally and must not be public API).
--
-- RLS is NOT changed. Every policy is `to authenticated`, so signed-in users
-- keep EXECUTE on the helpers the policies call; anon never evaluates them.
-- ============================================================================

-- Policy/storage helpers: signed-in users only.
revoke execute on function
  public.is_enforcement_member_for(text),
  public.can_access_case(uuid),
  public.can_upload_officer_evidence(text),
  public.can_read_report_evidence_object(text),
  public.can_read_officer_evidence_object(text),
  public.try_uuid(text)
from public, anon;

grant execute on function
  public.is_enforcement_member_for(text),
  public.can_access_case(uuid),
  public.can_upload_officer_evidence(text),
  public.can_read_report_evidence_object(text),
  public.can_read_officer_evidence_object(text),
  public.try_uuid(text)
to authenticated;

-- Trigger functions are never called directly (triggers do not need EXECUTE
-- at fire time); nobody gets them as API.
revoke execute on function
  public.handle_new_auth_user(),
  public.set_updated_at(),
  public.reject_modification(),
  public.reject_truncate()
from public, anon, authenticated;

-- Future functions created by this role in `public` are no longer auto-granted
-- to PUBLIC/anon; every migration grants explicitly (as all of ours already do).
-- (Global form removes the built-in PUBLIC default; schema form removes the
-- Supabase schema-level grant to anon.)
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public, anon;

-- Pin search_path on the remaining invoker functions (Supabase advisor
-- "function_search_path_mutable"). Their bodies use only built-ins
-- (now(), raise, ::uuid), which resolve with an empty search_path.
alter function public.set_updated_at() set search_path = '';
alter function public.reject_modification() set search_path = '';
alter function public.reject_truncate() set search_path = '';
alter function public.pw_fail(text, text) set search_path = '';
alter function public.try_uuid(text) set search_path = '';
