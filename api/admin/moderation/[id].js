import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.query;
  const { status } = req.body;
  const appdata = createClient(process.env.SUPABASE_APPDATA_URL, process.env.SUPABASE_APPDATA_SERVICE_KEY);

  try {
    const { data, error } = await appdata.from('recipe_reports').update({ status }).eq('id', id).select().single();
    if (error) throw error;
    res.status(200).json({ report: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
