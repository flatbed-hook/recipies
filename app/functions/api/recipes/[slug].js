import { requireAuth } from '../login.js';
import { problemWith, recipeFrom } from '../recipes.js';

const notFound = () => Response.json({ error: 'Recipe not found' }, { status: 404 });

export const onRequestGet = async ({ params, env }) => {
  const row = await env.DB.prepare('SELECT json FROM recipes WHERE slug = ?').bind(params.slug).first();
  return row ? new Response(row.json, { headers: { 'content-type': 'application/json' } }) : notFound();
};

// Whole-object replacement: a text edit, a retag, and a reorder are all this one call. The slug
// comes from the URL and is never re-derived, so renaming a recipe leaves shared links working.
//
// Conflict detection lives in the WHERE clause rather than a read-then-compare, so two phones
// saving at once cannot both pass the check: whoever writes second no longer matches the
// `updatedAt` they loaded, changes 0 rows, and is told so instead of erasing the other's edit.
// ponytail: `updatedAt` is second-granularity (ticket 05 matched the migrated format), so a save
// landing inside the same second as the version it replaces leaves the version string unchanged,
// and a writer still holding that string would match. Add a counter column if that sub-second
// window ever matters.
export const onRequestPut = async (context) => {
  const denied = await requireAuth(context); // Belt and braces: _middleware.js checks this too.
  if (denied) return denied;

  const input = (await context.request.json().catch(() => null)) ?? {};
  const recipe = recipeFrom(input, context.params.slug);

  const problem = problemWith(recipe);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  const { meta } = await context.env.DB.prepare('UPDATE recipes SET json = ?, updated_at = ? WHERE slug = ? AND updated_at = ?')
    .bind(JSON.stringify(recipe), recipe.updatedAt, recipe.slug, String(input.updatedAt ?? ''))
    .run();
  if (meta.changes) return Response.json(recipe);

  // Nothing matched: either the recipe is gone, or someone saved it since this writer loaded it.
  const exists = await context.env.DB.prepare('SELECT 1 FROM recipes WHERE slug = ?').bind(recipe.slug).first();
  return exists
    ? Response.json(
        { error: 'Someone else saved this recipe since you opened it. Reload the page to see their version, then make your change again.' },
        { status: 409 },
      )
    : notFound();
};

export const onRequestDelete = async (context) => {
  const denied = await requireAuth(context);
  if (denied) return denied;

  const { meta } = await context.env.DB.prepare('DELETE FROM recipes WHERE slug = ?').bind(context.params.slug).run();
  return meta.changes ? Response.json({ deleted: context.params.slug }) : notFound();
};
