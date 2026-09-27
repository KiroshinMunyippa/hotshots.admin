import { createClient } from '@supabase/supabase-js';
import { verifyAdmin } from '../../lib/verifyAdmin.js';

export default async function handler(req, res) {
  const admin = await verifyAdmin(req);
  if (!admin) return res.status(403).json({ error: 'Admin access required' });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const accounts = createClient(process.env.SUPABASE_ACCOUNTS_URL, process.env.SUPABASE_ACCOUNTS_SERVICE_KEY);

  try {
    const { data: logs, error } = await accounts.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    res.status(200).json(logs || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
