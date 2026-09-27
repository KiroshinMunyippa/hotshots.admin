import { verifyAdmin, accountsAdmin } from '../../../lib/verifyAdmin.js';
import { appData } from '../../../lib/appData.js';

export default async function handler(req, res) {
  const admin = await verifyAdmin(req);
  if (!admin) return res.status(403).json({ error: 'Admin access required' });
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).end(); }

  // `columns=*` on purpose: the admin portal edits a handful of recipe fields
  // (description, times, image...), so the full row has to come back. If a
  // column listed in EDITABLE_FIELDS below is missing from your table, drop it
  // from that list in [id].js -- and remove it here too.
  const { data: recipes, error } = await appData
    .from('recipes')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const { data: ratings } = await appData.from('recipe_ratings').select('recipe_id, rating');
  const ratingMap = {};
  (ratings || []).forEach(r => {
    const bucket = ratingMap[r.recipe_id] || { total: 0, count: 0 };
    bucket.total += r.rating; bucket.count += 1; ratingMap[r.recipe_id] = bucket;
  });

  // Recipes and profiles live in separate databases -- there's no SQL join
  // across them, so authors are resolved with a second lookup and stitched
  // together here.
  const authorIds = [...new Set(recipes.map(r => r.author_id))];
  const { data: authors } = authorIds.length
    ? await accountsAdmin.from('profiles').select('id, display_name, email').in('id', authorIds)
    : { data: [] };
  const authorMap = Object.fromEntries((authors || []).map(a => [a.id, a]));

  // The raw row is spread first so the edit form can read every column back;
  // `shared` / `createdAt` stay as aliases for anything already using them.
  const shaped = recipes.map(r => ({
    ...r,
    shared: r.is_shared,
    createdAt: r.created_at,
    rating: ratingMap[r.id] || { total: 0, count: 0 },
    author: authorMap[r.author_id] || { display_name: 'Unknown', email: r.author_id }
  }));
  return res.status(200).json({ recipes: shaped });
}
