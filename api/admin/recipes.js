import { verifyAdmin, accountsAdmin } from '../../../lib/verifyAdmin.js';
import { appData } from '../../../lib/appData.js';
import ws from 'ws';

export default async function handler(req, res) {
  const admin = await verifyAdmin(req);
  if (!admin) return res.status(403).json({ error: 'Admin access required' });

  // Handle /api/admin/recipes (no ID) - list all recipes
  if (!req.query.id) {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).end(); }

    const { data: recipes, error } = await appData
      .from('recipes')
      .select('id, name, category, author_id, is_shared, created_at')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    const { data: ratings } = await appData.from('recipe_ratings').select('recipe_id, rating');
    const ratingMap = {};
    (ratings || []).forEach(r => {
      const bucket = ratingMap[r.recipe_id] || { total: 0, count: 0 };
      bucket.total += r.rating; bucket.count += 1; ratingMap[r.recipe_id] = bucket;
    });

    const authorIds = [...new Set(recipes.map(r => r.author_id))];
    const { data: authors } = authorIds.length
      ? await accountsAdmin.from('profiles').select('id, display_name, email').in('id', authorIds)
      : { data: [] };
    const authorMap = Object.fromEntries((authors || []).map(a => [a.id, a]));

    const shaped = recipes.map(r => ({
      id: r.id, name: r.name, category: r.category, shared: r.is_shared, createdAt: r.created_at,
      rating: ratingMap[r.id] || { total: 0, count: 0 },
      author: authorMap[r.author_id] || { display_name: 'Unknown', email: r.author_id }
    }));
    return res.status(200).json({ recipes: shaped });
  }

  // Handle /api/admin/recipes/[id] - get specific recipe details
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  
  try {
    const { data: recipes, error } = await appData
      .from('recipes')
      .select(`
        *,
        author:profiles!recipes_author_id (
          display_name,
          email
        ),
        rating:recipe_ratings (
          rating
        )
      `)
      .eq('id', id)
      .single();

    if (error) throw error;

    const recipeWithRating = {
      ...recipes,
      rating: {
        total: recipes.rating?.reduce((sum, r) => sum + r.rating, 0) || 0,
        count: recipes.rating?.length || 0
      }
    };

    res.status(200).json({ recipe: recipeWithRating });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
