-- Run this in the ACCOUNTS Supabase project (the same one as db/add-admin-flag.sql).
-- Creates the table /api/admin/logAudit.js writes to and /api/admin/audit.js reads
-- from. Without it, every admin action that tries to record an audit entry fails
-- with "relation public.audit_logs does not exist" (HTTP 500).

create table if not exists public.audit_logs (
  id           uuid primary key default gen_random_uuid(),
  admin_email  text        not null default 'Unknown Admin',
  action       text        not null,
  details      jsonb       not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);

-- The service-role key used by the serverless functions bypasses RLS, but we
-- explicitly enable it so no anon/authenticated role can ever read or write
-- this table directly from a browser.
alter table public.audit_logs enable row level security;
