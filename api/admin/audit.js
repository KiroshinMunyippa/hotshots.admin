import { createClient } from '@supabase/supabase-js';
import { verifyAdmin } from '../../lib/verifyAdmin.js';
import { logAudit } from './logAudit.js';

export default async function handler(req, res) {
  const admin = await verifyAdmin(req);
  if (!admin) return res.status(403).json({ error: 'Admin access required' });
  const accounts = createClient(process.env.SUPABASE_ACCOUNTS_URL, process.env.SUPABASE_ACCOUNTS_SERVICE_KEY);

  // DELETE /api/admin/audit?olderThanDays=N -- purge old entries (Settings tab).
  if (req.method === 'DELETE') {
    const days = Number(req.query.olderThanDays);
    if (!Number.isFinite(days) || days < 1) {
      return res.status(400).json({ error: 'olderThanDays must be a number of at least 1' });
    }
    try {
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();
      const { data, error } = await accounts.from('audit_logs')
        .delete({ count: 'exact' })
        .lt('created_at', cutoff)
        .select('id');
      if (error) throw error;
      await logAudit(admin.email, 'audit_purged', { olderThanDays: days, removed: (data || []).length, cutoff });
      res.status(200).json({ removed: (data || []).length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
    return;
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { data: logs, error } = await accounts.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    res.status(200).json(logs || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
