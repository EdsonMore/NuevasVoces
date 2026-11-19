-- Ejecutar una vez en el SQL Editor del proyecto Supabase.
-- El agregado guarda obras, asignaciones, escenas y propuestas de forma atómica.
create table if not exists public.sound_workspaces (
  id text primary key,
  revision bigint not null default 1 check (revision > 0),
  state jsonb not null check (
    jsonb_typeof(state->'shows') = 'array'
    and jsonb_typeof(state->'proposals') = 'array'
  ),
  updated_at timestamptz not null default now()
);

alter table public.sound_workspaces enable row level security;
revoke all on public.sound_workspaces from anon, authenticated;
grant select, insert, update on public.sound_workspaces to service_role;
