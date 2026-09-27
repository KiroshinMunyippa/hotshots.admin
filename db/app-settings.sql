-- Run this in the ACCOUNTS Supabase project (same one as db/add-admin-flag.sql).
-- Creates the key/value table backing the Settings tab (/api/admin/setting.js)
-- and seeds every known setting with its default value.

create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

insert into public.app_settings (key, value) values
  -- Feature flags & app config
  ('explore_enabled',            'true'::jsonb),
  ('registration_open',          'true'::jsonb),
  ('maintenance_mode',           'false'::jsonb),
  ('free_recipe_limit',          '50'::jsonb),
  ('max_upload_mb',              '10'::jsonb),
  -- Moderation policies
  ('autohide_report_threshold',  '5'::jsonb),
  ('require_email_verification', 'false'::jsonb),
  ('blocked_words',              '[]'::jsonb),
  ('blocked_tags',               '[]'::jsonb),
  -- Notifications & integrations
  ('slack_webhook_url',          '""'::jsonb),
  ('discord_webhook_url',        '""'::jsonb),
  ('daily_digest_email',         'false'::jsonb),
  -- Audit log management
  ('audit_retention_days',       '90'::jsonb),
  -- Plans & billing defaults
  ('plus_plan_price',            '4.99'::jsonb),
  ('pro_plan_price',             '9.99'::jsonb),
  ('trial_length_days',          '14'::jsonb),
  ('comp_everyone',              'false'::jsonb)
on conflict (key) do nothing;
