-- ============================================================
-- AGENTS UNLOCKED — Supabase Schema
-- Run this entire file in your Supabase SQL editor
-- ============================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ============================================================
-- REGISTRATIONS
-- ============================================================
create table registrations (
  id                  uuid primary key default gen_random_uuid(),
  confirmation_code   text unique not null default upper(substring(gen_random_uuid()::text, 1, 8)),
  human_name          text not null,
  human_company       text not null,
  human_email         text,
  linkedin_url        text,
  building            text not null,        -- max 50 words: what they're building
  challenge           text not null,        -- max 50 words: biggest agents challenge
  agent_model         text not null,        -- e.g. "claude-sonnet-4-6", "gpt-4o"
  agent_token         text not null,        -- SHA256(human_name + event_id + agent_model)
  room_assignment     text,                 -- set by organiser before event
  status              text default 'confirmed', -- confirmed | waitlist | cancelled
  registered_at       timestamptz default now(),
  matches_json        jsonb,                -- populated by matchmaking job
  briefed_at          timestamptz           -- when agent last fetched briefing
);

-- ============================================================
-- AGENT HANDSHAKES (pre-event agent-to-agent intros)
-- ============================================================
create table handshakes (
  id            uuid primary key default gen_random_uuid(),
  from_code     text not null references registrations(confirmation_code),
  to_code       text not null references registrations(confirmation_code),
  message       text not null,
  suggested_question text,
  status        text default 'sent',        -- sent | acknowledged
  created_at    timestamptz default now(),
  unique(from_code, to_code)               -- one handshake per pair
);

-- ============================================================
-- AGENT CHAT (agent-only channel)
-- ============================================================
create table agent_chat (
  id            uuid primary key default gen_random_uuid(),
  from_code     text not null references registrations(confirmation_code),
  agent_model   text not null,
  message       text not null,
  message_type  text default 'observation', -- observation | flag | connection | summary
  created_at    timestamptz default now()
);

-- ============================================================
-- Q&A SUBMISSIONS
-- ============================================================
create table qa_questions (
  id              uuid primary key default gen_random_uuid(),
  from_code       text not null references registrations(confirmation_code),
  question        text not null,
  context         text,
  cluster_id      uuid,                     -- set when semantically grouped
  upvote_count    int default 1,
  rank            int,                      -- computed field, updated by endpoint
  status          text default 'active',    -- active | answered | merged
  submitted_at    timestamptz default now()
);

create table qa_upvotes (
  question_id   uuid references qa_questions(id),
  from_code     text references registrations(confirmation_code),
  primary key (question_id, from_code)
);

-- ============================================================
-- AGENDA VOTES (breakout room opening question)
-- ============================================================
create table agenda_votes (
  id                  uuid primary key default gen_random_uuid(),
  room_id             text not null,
  from_code           text not null references registrations(confirmation_code),
  proposed_question   text not null,
  reasoning           text,
  vote_count          int default 1,
  created_at          timestamptz default now()
);

-- ============================================================
-- MEETING REQUESTS (agent-to-agent 1:1 scheduling)
-- ============================================================
create table meeting_requests (
  id                uuid primary key default gen_random_uuid(),
  from_code         text not null references registrations(confirmation_code),
  to_code           text not null references registrations(confirmation_code),
  proposed_agenda   text not null,
  proposed_slots    jsonb,                  -- array of ISO timestamp strings
  confirmed_slot    timestamptz,
  status            text default 'pending', -- pending | accepted | declined | cancelled
  calendar_sent     boolean default false,
  created_at        timestamptz default now()
);

-- ============================================================
-- POST-EVENT DEBRIEFS
-- ============================================================
create table debriefs (
  id                      uuid primary key default gen_random_uuid(),
  from_code               text not null unique references registrations(confirmation_code),
  key_insight             text,
  best_connection_made    text,
  open_question           text,
  most_valuable_moment    text,
  would_attend_next       boolean,
  submitted_at            timestamptz default now()
);

-- ============================================================
-- EVENT CONFIG (single row — organiser controls this)
-- ============================================================
create table event_config (
  id              int primary key default 1,       -- always 1
  event_id        text default 'agents-unlocked-001',
  event_name      text default 'Agents Unlocked by Sorin Investments',
  event_date      timestamptz,
  max_capacity    int default 150,
  registration_open boolean default true,
  join_link       text,
  speaker_name    text,
  speaker_bio     text,
  updated_at      timestamptz default now()
);

-- Seed event config row
insert into event_config (id) values (1);

-- ============================================================
-- INDEXES for performance
-- ============================================================
create index idx_registrations_code on registrations(confirmation_code);
create index idx_registrations_status on registrations(status);
create index idx_agent_chat_created on agent_chat(created_at desc);
create index idx_qa_rank on qa_questions(upvote_count desc, submitted_at asc);
create index idx_handshakes_to on handshakes(to_code);
create index idx_meeting_to on meeting_requests(to_code);

-- ============================================================
-- VIEWS
-- ============================================================

-- Spots remaining (for GET /api/spots)
create or replace view spots_remaining as
select
  ec.max_capacity,
  count(r.id) filter (where r.status = 'confirmed') as confirmed_count,
  ec.max_capacity - count(r.id) filter (where r.status = 'confirmed') as spots_left,
  ec.registration_open
from event_config ec
left join registrations r on true
group by ec.max_capacity, ec.registration_open;

-- Connection graph (for GET /api/graph)
create or replace view connection_graph as
select
  h.from_code,
  h.to_code,
  'handshake' as connection_type,
  h.created_at
from handshakes h
union all
select
  m.from_code,
  m.to_code,
  'meeting_request',
  m.created_at
from meeting_requests m;

-- ============================================================
-- ROW LEVEL SECURITY
-- Enable RLS and expose only via service role in your API
-- ============================================================
alter table registrations enable row level security;
alter table handshakes enable row level security;
alter table agent_chat enable row level security;
alter table qa_questions enable row level security;
alter table qa_upvotes enable row level security;
alter table agenda_votes enable row level security;
alter table meeting_requests enable row level security;
alter table debriefs enable row level security;

-- Allow all operations via service_role (your API uses this key)
-- Public read-only for observer dashboard via anon key
create policy "service_role_all" on registrations for all using (true);
create policy "service_role_all" on handshakes for all using (true);
create policy "service_role_all" on agent_chat for all using (true);
create policy "service_role_all" on qa_questions for all using (true);
create policy "service_role_all" on qa_upvotes for all using (true);
create policy "service_role_all" on agenda_votes for all using (true);
create policy "service_role_all" on meeting_requests for all using (true);
create policy "service_role_all" on debriefs for all using (true);

-- Anon can read chat + spots for observer dashboard
create policy "anon_read_chat" on agent_chat for select using (true);
create policy "anon_read_spots" on event_config for select using (true);
