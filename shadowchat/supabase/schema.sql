-- ShadowChat guest-chat foundation.
-- Run in Supabase SQL Editor. Access must go through Edge Functions using the
-- server-only service role key. Never expose that key in the browser.
create extension if not exists pgcrypto;

create table if not exists public.chat_rooms (
  id uuid primary key default gen_random_uuid(),
  secret_hash text not null,
  owner_token_hash text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists public.guest_sessions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  token_hash text not null unique,
  display_name text not null default 'Guest',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  session_id uuid not null references public.guest_sessions(id) on delete cascade,
  ciphertext text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_room_created_idx
  on public.chat_messages(room_id, created_at);
create index if not exists guest_sessions_room_idx
  on public.guest_sessions(room_id);

alter table public.chat_rooms enable row level security;
alter table public.guest_sessions enable row level security;
alter table public.chat_messages enable row level security;

-- No direct browser access. Edge Functions must validate hashed session tokens
-- and use the server-side service role key. Do not create permissive anon policies.
revoke all on public.chat_rooms from anon, authenticated;
revoke all on public.guest_sessions from anon, authenticated;
revoke all on public.chat_messages from anon, authenticated;
