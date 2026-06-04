-- One-A-Day — Supabase schema
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query)

-- Single-row-per-user table. The entire OAD.DB object is stored as JSONB.
-- Simple to migrate from localStorage; normalize individual tables later
-- once the schema stabilizes.
create table if not exists user_data (
  user_id  uuid primary key references auth.users on delete cascade,
  db       jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- Row-Level Security: each user can only read and write their own row.
alter table user_data enable row level security;

create policy "users manage own data"
  on user_data for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Automatically stamp updated_at on every write.
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger user_data_updated_at
  before update on user_data
  for each row execute procedure set_updated_at();
