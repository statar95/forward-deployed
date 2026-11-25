-- Forward Deployed: the whole backend.
--
-- Run this once in the Supabase SQL editor (Dashboard > SQL Editor > New query > Run).
-- It is safe to run again: every statement is guarded.
--
-- Two tables. `candidates` is the person: one row, owned by them, created on first Google sign in.
-- `applications` is the click: which role they opened, so the board can tell an employer how much
-- interest a listing got without ever showing them who.

create table if not exists public.candidates (
  id          uuid primary key references auth.users on delete cascade,
  email       text,
  full_name   text,
  headline    text,
  industries  text[] not null default '{}',
  countries   text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.applications (
  id          bigserial primary key,
  candidate   uuid not null default auth.uid() references public.candidates(id) on delete cascade,
  role_id     text not null,
  company     text not null,
  title       text not null,
  created_at  timestamptz not null default now()
);

create index if not exists applications_role_idx on public.applications (role_id);
create index if not exists applications_candidate_idx on public.applications (candidate);

-- The four onboarding answers and the two consents (added 20 Sep 2026, phase 2).
alter table public.candidates add column if not exists job_family text;
alter table public.candidates add column if not exists level text;
alter table public.candidates add column if not exists looking text;
alter table public.candidates add column if not exists horizontal boolean not null default true;
alter table public.candidates add column if not exists linkedin_url text;
alter table public.candidates add column if not exists consent_employers boolean not null default false;
alter table public.candidates add column if not exists digest boolean not null default true;
alter table public.candidates add column if not exists onboarded_at timestamptz;

-- Roles someone kept, so their briefing follows them between devices.
create table if not exists public.saved_roles (
  candidate  uuid not null default auth.uid() references public.candidates(id) on delete cascade,
  role_id    text not null,
  company    text not null,
  title      text not null,
  created_at timestamptz not null default now(),
  primary key (candidate, role_id)
);

-- Row level security: a signed in person reads and writes their own row and nobody else's.
-- Without these policies the anon key would be a public read of every candidate.
alter table public.candidates enable row level security;
alter table public.applications enable row level security;
alter table public.saved_roles enable row level security;

drop policy if exists "candidates read own" on public.candidates;
create policy "candidates read own" on public.candidates
  for select using (auth.uid() = id);

drop policy if exists "candidates insert own" on public.candidates;
create policy "candidates insert own" on public.candidates
  for insert with check (auth.uid() = id);

drop policy if exists "candidates update own" on public.candidates;
create policy "candidates update own" on public.candidates
  for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "applications read own" on public.applications;
create policy "applications read own" on public.applications
  for select using (auth.uid() = candidate);

drop policy if exists "applications insert own" on public.applications;
create policy "applications insert own" on public.applications
  for insert with check (auth.uid() = candidate);

-- Keep updated_at honest.
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists candidates_touch on public.candidates;
create trigger candidates_touch before update on public.candidates
  for each row execute function public.touch_updated_at();

drop policy if exists "saved read own" on public.saved_roles;
create policy "saved read own" on public.saved_roles for select using (auth.uid() = candidate);

drop policy if exists "saved insert own" on public.saved_roles;
create policy "saved insert own" on public.saved_roles for insert with check (auth.uid() = candidate);

drop policy if exists "saved delete own" on public.saved_roles;
create policy "saved delete own" on public.saved_roles for delete using (auth.uid() = candidate);

-- The briefing list is NOT here. It lives in Resend (see api/subscribe.ts): the only thing we do
-- with an address is send one email a week, and Resend already owns the sending and the unsubscribe.
