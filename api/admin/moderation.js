import { verifyAdmin } from '../../../lib/verifyAdmin.js';
import { appData } from '../../../lib/appData.js';
import { logAudit } from '../../../lib/logAudit.js';

export default async function handler(req, res) {
  const admin = await verifyAdmin(req);
  if (!admin) return res.status(403).json({ error: 'Admin access required' });

  // Handle /api/admin/moderation (no ID) - list pending reports or update status
  if (!req.query.id) {
    // GET: Fetch pending reports
    if (req.method === 'GET') {
      try {
        const { data: reports } = await appData
          .from('recipe_reports')
          .select('*, recipe:recipes(id, name, author_id, shared)')
          .eq('status', 'pending')
          .order('created_at', { ascending: false });
        return res.status(200).json(reports || []);
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }

    // PATCH: Dismiss a report OR Delete the reported recipe
    if (req.method === 'PATCH') {
      const { reportId, action, recipeId } = req.body;
      if (!reportId) return res.status(400).json({ error: 'Missing reportId' });

      try {
        if (action === 'dismiss') {
          await appData.from('recipe_reports').update({ status: 'resolved' }).eq('id', reportId);
          return res.status(200).json({ message: 'Report dismissed' });
        }
        
        if (action === 'delete_recipe') {
          if (recipeId) {
            await appData.from('recipes').delete().eq('id', recipeId);
          }
          await appData.from('recipe_reports').update({ status: 'resolved' }).eq('id', reportId);
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

  // Handle /api/admin/moderation/[id] - update specific report status
  const { id } = req.query;
  
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
  
  const { status } = req.body;

  try {
    const { data, error } = await appData.from('recipe_reports').update({ status }).eq('id', id).select().single();
    if (error) throw error;
    res.status(200).json({ report: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
