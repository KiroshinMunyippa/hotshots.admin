import { logAudit } from '../../lib/logAudit.js';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  const appdata = createClient(process.env.SUPABASE_APPDATA_URL, process.env.SUPABASE_APPDATA_SERVICE_KEY);

  // 1. GET: Fetch pending reports
  if (req.method === 'GET') {
    try {
      const { data: reports } = await appdata
        .from('recipe_reports')
        .select('*, recipe:recipes(id, name, author_id, shared)')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      return res.status(200).json(reports || []);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // 2. PATCH: Dismiss a report OR Delete the reported recipe
  if (req.method === 'PATCH') {
    const { reportId, action, recipeId } = req.body;
    if (!reportId) return res.status(400).json({ error: 'Missing reportId' });

    try {
      if (action === 'dismiss') {
        // Just mark the report as resolved
        await appdata.from('recipe_reports').update({ status: 'resolved' }).eq('id', reportId);
        return res.status(200).json({ message: 'Report dismissed' });
      }
      
      if (action === 'delete_recipe') {
        if (recipeId) {
          await appdata.from('recipes').delete().eq('id', recipeId);
        }
        await appdata.from('recipe_reports').update({ status: 'resolved' }).eq('id', reportId);
        
        // 👇 ADD THIS LOGGING LINE 👇
        await logAudit('Admin', 'Deleted Recipe', { recipeId: recipeId, reportId: reportId });
        
        return res.status(200).json({ message: 'Recipe deleted and report resolved' });
      }
      return res.status(400).json({ error: 'Invalid action' });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
