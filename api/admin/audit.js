import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const accounts = createClient(process.env.SUPABASE_ACCOUNTS_URL, process.env.SUPABASE_ACCOUNTS_SERVICE_KEY);

  try {
    const { data: logs } = await accounts.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(100);
    res.status(200).json(logs || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
