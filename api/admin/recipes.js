import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const appdata = createClient(
    process.env.SUPABASE_APPDATA_URL,
    process.env.SUPABASE_APPDATA_SERVICE_KEY
  );

  const accounts = createClient(
    process.env.SUPABASE_ACCOUNTS_URL,
    process.env.SUPABASE_ACCOUNTS_SERVICE_KEY
  );

  try {
    // 1. Fetch all recipes
    const { data: recipes, error: recipesError } = await appdata
      .from('recipes')
      .select('*')
      .order('created_at', { ascending: false });

    if (recipesError) throw recipesError;

    // 2. Fetch all ratings
    const { data: ratings } = await appdata
      .from('recipe_ratings')
      .select('recipe_id, rating');

    // 3. Get unique author IDs from recipes
    const authorIds = [...new Set(recipes.map(r => r.author_id))];

    // 4. Fetch author profiles from Accounts project
    const { data: authors } = await accounts
      .from('profiles')
      .select('id, display_name, email')
      .in('id', authorIds);

    // 5. Combine data
    const recipesWithAuthors = recipes.map(recipe => {
      const author = authors?.find(a => a.id === recipe.author_id) || { display_name: 'Unknown', email: '' };
      const recipeRatings = ratings?.filter(r => r.recipe_id === recipe.id) || [];
      
      return {
        ...recipe,
        author: {
          display_name: author.display_name,
          email: author.email
        },
        rating: {
          total: recipeRatings.reduce((sum, r) => sum + r.rating, 0),
          count: recipeRatings.length
        }
      };
    });

    res.status(200).json({ recipes: recipesWithAuthors });
  } catch (error) {
    console.error('Recipes API error:', error);
    res.status(500).json({ error: error.message });
  }
}
