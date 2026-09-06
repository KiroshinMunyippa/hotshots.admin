import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  const { id } = req.query;
  
  const supabase = createClient(
    process.env.SUPABASE_ACCOUNTS_URL,
    process.env.SUPABASE_ACCOUNTS_SERVICE_KEY
  );

  if (req.method === 'PATCH') {
    try {
      const { subscription_plan, subscription_status } = req.body;
      const { data, error } = await supabase
        .from('profiles')
        .update({ subscription_plan, subscription_status, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      res.status(200).json({ user: data });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
