import { createClient } from '@supabase/supabase-js';

// Service-role key: bypasses Row Level Security. Server-side only, never sent
// to the browser.
export const appData = createClient(
  process.env.SUPABASE_APPDATA_URL,
  process.env.SUPABASE_APPDATA_SERVICE_KEY,
  { auth: { persistSession: false } }
);
