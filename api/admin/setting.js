import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  const accounts = createClient(process.env.SUPABASE_ACCOUNTS_URL, process.env.SUPABASE_ACCOUNTS_SERVICE_KEY);

  if (req.method === 'GET') {
    const { data: settings } = await accounts.from('app_settings').select('*');
    res.status(200).json(settings || []);
  } else if (req.method === 'PATCH') {
    const { key, value } = req.body;
    const { data, error } = await accounts.from('app_settings').update({ value, updated_at: new Date().toISOString() }).eq('key', key).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(200).json(data);
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
