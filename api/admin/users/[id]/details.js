import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.query; // Use `req.params` if using Next.js App Router

  const accounts = createClient(process.env.SUPABASE_ACCOUNTS_URL, process.env.SUPABASE_ACCOUNTS_SERVICE_KEY);
  const appdata = createClient(process.env.SUPABASE_APPDATA_URL, process.env.SUPABASE_APPDATA_SERVICE_KEY);

  try {
    if (req.method === 'GET') {
      const { data: user } = await accounts.from('profiles').select('*').eq('id', id).single();
      const { data: recipes } = await appdata.from('recipes').select('id, name, created_at, shared').eq('author_id', id);
      res.status(200).json({ user, recipes: recipes || [] });
    } else {
      const { admin_notes } = req.body;
      const { data, error } = await accounts.from('profiles').update({ admin_notes }).eq('id', id).select().single();
      if (error) throw error;
      res.status(200).json({ user: data });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}