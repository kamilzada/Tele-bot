-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run.

create table if not exists notes (
  id                  uuid primary key default gen_random_uuid(),
  chat_id             text not null,
  telegram_update_id  bigint unique,          -- dedupes Telegram re-deliveries
  text                text not null,
  score               int,
  score_reason        text,
  status              text default 'received', -- received | drafted | rejected
  created_at          timestamptz default now()
);

create table if not exists drafts (
  id                   uuid primary key default gen_random_uuid(),
  note_id              uuid references notes(id),
  chat_id              text not null,
  content              text not null,
  model                text,
  news_query           text,
  news_headline        text,
  news_source          text,
  news_date            text,
  news_url             text,
  status               text not null default 'pending', -- pending | approved | rejected
  telegram_message_id  bigint,
  created_at           timestamptz default now(),
  reviewed_at          timestamptz
);

-- Keeps a copy of each voice-skill version you use, for comparing drafts over time.
-- (The bot reads voice-skill.txt from the project; paste new versions here when you change it.)
create table if not exists voice_skill (
  id          uuid primary key default gen_random_uuid(),
  version     text not null,
  content     text not null,
  created_at  timestamptz default now()
);

create index if not exists drafts_pending_idx on drafts (chat_id, status, created_at desc);

-- The bot uses the service_role key, which bypasses RLS. Enabling RLS with no
-- policies blocks the public anon key from reading Meera's notes.
alter table notes enable row level security;
alter table drafts enable row level security;
alter table voice_skill enable row level security;
