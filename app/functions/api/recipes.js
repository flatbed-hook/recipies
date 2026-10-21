export const onRequestGet = async ({ env }) => {
  const { results } = await env.DB.prepare('SELECT json FROM recipes ORDER BY slug').all();
  return Response.json(results.map((row) => JSON.parse(row.json)));
};
