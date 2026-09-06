import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const appdata = createClient(
    process.env.SUPABASE_APPDATA_URL,
    process.env.SUPABASE_APPDATA_SERVICE_KEY
  );

  try {
    const { data: reports } = await appdata
      .from('recipe_reports')
      .select(`
        *,
        recipe:recipes(id, name, author_id, shared)
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    res.status(200).json({ reports: reports || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
