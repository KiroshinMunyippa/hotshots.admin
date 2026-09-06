import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = createClient(
    process.env.SUPABASE_APPDATA_URL,
    process.env.SUPABASE_APPDATA_SERVICE_KEY
  );

  try {
    const { data: recipes, error } = await supabase
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
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Calculate rating totals
    const recipesWithRatings = recipes.map(recipe => ({
      ...recipe,
      rating: {
        total: recipe.rating?.reduce((sum, r) => sum + r.rating, 0) || 0,
        count: recipe.rating?.length || 0
      }
    }));

    res.status(200).json({ recipes: recipesWithRatings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
