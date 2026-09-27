import { createClient } from '@supabase/supabase-js';
import { verifyAdmin } from '../../lib/verifyAdmin.js';
import { logAudit } from './logAudit.js';

// GET   /api/admin/setting        -> all rows of app_settings [{key, value, ...}]
// PATCH /api/admin/setting        -> body { key, value }; upserts the row so a
//                                    setting that hasn't been seeded yet still saves.
export default async function handler(req, res) {
  const admin = await verifyAdmin(req);
  if (!admin) return res.status(403).json({ error: 'Admin access required' });

  const accounts = createClient(process.env.SUPABASE_ACCOUNTS_URL, process.env.SUPABASE_ACCOUNTS_SERVICE_KEY);

  if (req.method === 'GET') {
    const { data: settings, error } = await accounts.from('app_settings').select('*');
    if (error) return res.status(500).json({ error: error.message });
    res.status(200).json(settings || []);
  } else if (req.method === 'PATCH') {
    const { key, value } = req.body || {};
    if (!key) return res.status(400).json({ error: 'Missing setting key' });

    // Try an update first; if the row doesn't exist yet, insert it. This keeps
    // working whether or not db/app-settings.sql has been run.
    let { data, error } = await accounts
      .from('app_settings')
      .update({ value, updated_at: new Date().toISOString() })
      .eq('key', key)
      .select()
      .single();

    if (error || !data) {
      const inserted = await accounts
        .from('app_settings')
        .insert({ key, value, updated_at: new Date().toISOString() })
        .select()
        .single();
      if (inserted.error) return res.status(500).json({ error: inserted.error.message });
      data = inserted.data;
    }

    logAudit(admin.email, 'setting_updated', { key, value });
    res.status(200).json(data);
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
