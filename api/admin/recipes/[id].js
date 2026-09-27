import { verifyAdmin } from '../../../lib/verifyAdmin.js';
import { appData } from '../../../lib/appData.js';
import { logAudit } from '../logAudit.js';

// Fields the admin is allowed to change on a recipe. `is_shared` is the
// visibility toggle (show/hide in Explore); everything else is editable copy.
// `price` is displayed as Rands (ZAR) in the admin portal.
const EDITABLE_FIELDS = ['name', 'description', 'category', 'cuisine', 'difficulty', 'price', 'prep_time', 'cook_time', 'servings', 'image_url', 'is_shared'];

// Different deployments of the recipes table have called the visibility column
// `is_shared`, `shared`, `visible` or `published`. If an UPDATE fails because
// the column we tried doesn't exist, retry with the next candidate and persist
// the winner here so subsequent requests skip straight to it.
const SHARED_COLUMN_CANDIDATES = ['is_shared', 'shared', 'visible', 'published'];
let resolvedSharedColumn = null;

const isMissingColumnError = (error) => /does not exist|column .*not (?:be )?found|undefined column|PGRST204/i.test(error?.message || '');

async function updateRecipe(updates, id) {
  const payload = { ...updates, updated_at: new Date().toISOString() };
  const run = (body) => appData.from('recipes').update(body).eq('id', id).select('*').single();

  let error = null;
  let result = await run(payload);
  if (!result.data && error === null && result.error) error = result.error;
  if (result.data) return result;

  // A missing-column failure on the visibility flag: probe the alternatives.
  if ('is_shared' in payload && isMissingColumnError(error)) {
    const candidates = SHARED_COLUMN_CANDIDATES.filter(c => c !== 'is_shared' && c !== resolvedSharedColumn);
    if (resolvedSharedColumn && resolvedSharedColumn !== 'is_shared') candidates.unshift(resolvedSharedColumn);
    for (const col of candidates) {
      const alt = { ...payload };
      alt[col] = alt.is_shared;
      delete alt.is_shared;
      const attempt = await run(alt);
      if (attempt.data) {
        resolvedSharedColumn = col;
        // Report back under the canonical name so clients don't need to know.
        return { data: { ...attempt.data, is_shared: attempt.data[col] ?? alt[col] }, error: null };
      }
    }
  }
  return result;
}

export default async function handler(req, res) {
  const admin = await verifyAdmin(req);
  if (!admin) return res.status(403).json({ error: 'Admin access required' });

  const { id } = req.query;

  if (req.method === 'PATCH') {
    try {
      const updates = Object.fromEntries(
        Object.entries(req.body || {}).filter(([key, value]) => EDITABLE_FIELDS.includes(key) && value !== undefined)
      );
      if (!Object.keys(updates).length) {
        return res.status(400).json({ error: 'Nothing to update' });
      }

      // Read the row first so we can record which fields actually changed and
      // what the recipe was called -- the audit list shows names, not UUIDs.
      const { data: before } = await appData
        .from('recipes')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      const { data, error } = await updateRecipe(updates, id);
      if (!data) throw error || new Error('Recipe not found');

      const changed = Object.fromEntries(
        Object.entries(updates).filter(([key, value]) => before?.[key] !== value)
      );
      await logAudit(admin.email, 'recipe_updated', {
        recipeId: id,
        recipeName: before?.name || data?.name || null,
        changes: Object.keys(changed).length ? changed : updates
      });
      return res.status(200).json({ recipe: data });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  if (req.method === 'DELETE') {
    try {
      // Ratings belong to the recipe, so clean them up first -- otherwise they
      // are left pointing at a row that no longer exists.
      await appData.from('recipe_ratings').delete().eq('recipe_id', id);
      await appData.from('recipe_reports').delete().eq('recipe_id', id);

      // Name needed for the audit entry, so look it up before it's gone.
      const { data: existing } = await appData.from('recipes').select('id, name').eq('id', id).maybeSingle();
      if (!existing) return res.status(404).json({ error: 'Recipe not found' });

      const { error } = await appData.from('recipes').delete().eq('id', id);
      if (error) throw error;

      await logAudit(admin.email, 'recipe_deleted', { recipeId: id, recipeName: existing.name || null });
      return res.status(200).json({ deleted: true, id });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  res.setHeader('Allow', 'PATCH, DELETE');
  return res.status(405).end();
}
