import { verifyAdmin } from '../../lib/verifyAdmin.js';
import { appData } from '../../lib/appData.js';
import { logAudit } from './logAudit.js';

export default async function handler(req, res) {
  const admin = await verifyAdmin(req);
  if (!admin) return res.status(403).json({ error: 'Admin access required' });

  // 1. GET: Fetch pending reports
  if (req.method === 'GET') {
    try {
      // `is_shared` is the actual column on this project's recipes table --
      // asking for a non-existent `shared` column here made Supabase throw,
      // which surfaced as a 500 with an HTML/plain-text body the browser
      // couldn't JSON-parse ("Unexpected identifier 'A'").
      const { data: reports, error } = await appData
        .from('recipe_reports')
        .select('*, recipe:recipes(id, name, author_id, is_shared)')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json(reports || []);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // 2. PATCH: Dismiss a report OR Delete the reported recipe
  if (req.method === 'PATCH') {
    const { reportId, action, recipeId } = req.body || {};
    if (!reportId) return res.status(400).json({ error: 'Missing reportId' });

    try {
      if (action === 'dismiss') {
        // Just mark the report as resolved
        const { error } = await appData.from('recipe_reports').update({ status: 'resolved' }).eq('id', reportId);
        if (error) throw error;

        // Look up the recipe name (if it still exists) so the audit entry can
        // read "Dismissed a report on \"Taco Soup\"" instead of a bare UUID.
        let dismissedRecipeName = null;
        try {
          const { data: rep } = await appData
            .from('recipe_reports')
            .select('recipe:recipes(name)')
            .eq('id', reportId)
            .maybeSingle();
          dismissedRecipeName = rep?.recipe?.name || null;
        } catch { /* best-effort */ }

        await logAudit(admin.email, 'report_dismissed', { reportId, recipeName: dismissedRecipeName });
        return res.status(200).json({ message: 'Report dismissed' });
      }

      if (action === 'delete_recipe') {
        let deletedRecipeName = null;
        if (recipeId) {
          const { data: doomed } = await appData.from('recipes').select('name').eq('id', recipeId).maybeSingle();
          deletedRecipeName = doomed?.name || null;
          // Ratings/reports belong to the recipe, so clean them up first --
          // otherwise they are left pointing at a row that no longer exists.
          await appData.from('recipe_ratings').delete().eq('recipe_id', recipeId);
          await appData.from('recipes').delete().eq('id', recipeId);
        }
        const { error } = await appData.from('recipe_reports').update({ status: 'resolved' }).eq('id', reportId);
        if (error) throw error;

        await logAudit(admin.email, 'recipe_deleted_via_report', { recipeId: recipeId, recipeName: deletedRecipeName, reportId: reportId });

        return res.status(200).json({ message: 'Recipe deleted and report resolved' });
      }
      return res.status(400).json({ error: 'Invalid action' });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
