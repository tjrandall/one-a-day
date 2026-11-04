-- Phase 1 write safety: versioned saves (optimistic concurrency).
--
-- T.J. runs this by hand in the Supabase SQL editor (Dashboard, SQL Editor, New query).
-- Claude Code does not run this. Builds on db/init/schema.sql; run that first if user_data
-- does not exist yet.
--
-- Why: every save used to be a blind upsert({user_id, db}) with no check against what the
-- server currently held, so whichever save landed last always won, silently, even if it was
-- built from an older read. This migration adds a version counter and moves the write behind
-- an RPC that only commits when the caller's expected version still matches the row's actual
-- version, so a save built from stale data is rejected instead of silently overwriting newer
-- data. See private design notes (fq-personal) for the incident this addresses.

alter table user_data add column if not exists version bigint not null default 0;

-- save_db replaces the old client-side upsert call. It updates the caller's own row only if
-- the row's current version still matches what the caller last read (p_expected_version),
-- then increments version and returns the new value. If no row was updated, either this is
-- genuinely the first save for this account (no row yet, handled below) or someone else's
-- save has already moved the version past what this caller saw, in which case it raises
-- version_conflict so the caller never silently overwrites newer data.
--
-- security invoker (the default) is deliberate: this function runs with the calling user's
-- own privileges, not the function owner's, so the existing row level security policy on
-- user_data ("users manage own data", auth.uid() = user_id) still applies to both the update
-- and the insert below. auth.uid() is read server side, not taken from a client parameter, so
-- a caller cannot pass another account's data into its own row or vice versa.
create or replace function save_db(p_db jsonb, p_expected_version bigint)
returns bigint
language plpgsql
security invoker
as $$
declare
  v_new_version bigint;
begin
  update user_data
     set db = p_db,
         version = version + 1
   where user_id = auth.uid()
     and version = p_expected_version
  returning version into v_new_version;

  if v_new_version is not null then
    return v_new_version;
  end if;

  -- No row was updated above. If this account has no row at all yet, and the caller expected
  -- version 0 (its initial, never-saved state), this is a first save: insert at version 1.
  if p_expected_version = 0 and not exists (select 1 from user_data where user_id = auth.uid()) then
    insert into user_data (user_id, db, version)
    values (auth.uid(), p_db, 1)
    returning version into v_new_version;
    return v_new_version;
  end if;

  raise exception 'version_conflict';
end;
$$;

grant execute on function save_db(jsonb, bigint) to authenticated;
