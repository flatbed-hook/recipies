export const onRequestGet = async ({ params, env }) => {
  const row = await env.DB.prepare('SELECT json FROM recipes WHERE slug = ?').bind(params.slug).first();
  return row
    ? new Response(row.json, { headers: { 'content-type': 'application/json' } })
    : Response.json({ error: 'Recipe not found' }, { status: 404 });
};
