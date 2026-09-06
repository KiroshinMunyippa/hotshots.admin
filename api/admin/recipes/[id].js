import { verifyAdmin } from '../../../lib/verifyAdmin.js';
import { appData } from '../../../lib/appData.js';

export default async function handler(req, res) {
  const admin = await verifyAdmin(req);
  if (!admin) return res.status(403).json({ error: 'Admin access required' });
  const id = req.query.id;

  if (req.method === 'PATCH') {
    const { shared } = req.body || {};
    if (typeof shared !== 'boolean') return res.status(400).json({ error: '"shared" must be true or false' });
    const { data, error } = await appData.from('recipes').update({ is_shared: shared, updated_at: new Date().toISOString() }).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ recipe: data });
  }

  if (req.method === 'DELETE') {
    // recipe_ingredients, recipe_instructions, and recipe_ratings all cascade
    // on delete (see db/appdata-schema.sql), so this one delete is enough.
    const { error } = await appData.from('recipes').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(204).end();
  }

  res.setHeader('Allow', 'PATCH, DELETE');
  return res.status(405).end();
}
