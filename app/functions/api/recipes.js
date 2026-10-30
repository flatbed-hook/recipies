import { requireAuth } from './login.js';

export const onRequestGet = async ({ env }) => {
  const { results } = await env.DB.prepare('SELECT json FROM recipes ORDER BY slug').all();
  return Response.json(results.map((row) => JSON.parse(row.json)));
};

// Slug style of the 16 migrated recipes: lowercase, accents and apostrophes dropped, every other
// run of punctuation or whitespace collapsed to one hyphen. "Chicken Soup + Stock" ->
// chicken-soup-stock. One legacy slug spells "&" as "and"; the rule here drops it like any other
// punctuation. Existing slugs are stored data and are not re-derived, so nothing moves.
export const slugify = (title) =>
  String(title ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ'’]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// Numbers count: schema.org hands back recipeYield as a bare number often enough that ignoring
// them would silently drop the servings of recipes ticket 06 extracts.
const str = (value) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '');
const list = (value) => (Array.isArray(value) ? value.map(str).filter(Boolean) : []);
// The detail page puts these straight into an <a href> and an <img src>, so only http(s) survives.
const link = (value) => (/^https?:\/\//i.test(str(value)) ? str(value) : '');

// Untrusted input in, exactly the 13 stored keys out: unknown keys dropped, absent values "" and
// never missing, so hand-created recipes stay interchangeable with the migrated ones.
// The slug defaults to one derived from the *stored* title, so there is a single definition of
// the title: one the normaliser rejects can never still yield a slug. Ticket 08 passes the
// existing slug instead, to keep links stable across a rename.
export const recipeFrom = (input, slug, updatedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z')) => {
  const title = str(input.title);
  return {
    slug: slug ?? slugify(title),
    title,
    description: str(input.description),
    tags: list(input.tags),
    servings: str(input.servings),
    prepTime: str(input.prepTime),
    cookTime: str(input.cookTime),
    image: link(input.image),
    ingredients: list(input.ingredients),
    steps: list(input.steps),
    notes: str(input.notes),
    source: { url: link(input.source?.url), name: str(input.source?.name) },
    updatedAt,
  };
};

// The same three rules for create and update. Ordered so the writer is told the real problem:
// an empty title is "no title", not "no Latin letters". Update passes the URL's slug, so a
// rename to a non-Latin title is fine there — nothing has to be derived from it.
export const problemWith = (recipe) => {
  if (!recipe.title) return 'A title is required';
  // ponytail: no transliteration. Add one the first time a native-script title is wanted.
  if (!recipe.slug) return 'That title has no Latin letters or digits, so no web address can be made from it. Add a title in Latin script.';
  if (!recipe.ingredients.length || !recipe.steps.length) return 'At least one ingredient and one step are required';
  return null;
};

export const onRequestPost = async (context) => {
  const denied = await requireAuth(context); // Belt and braces: _middleware.js checks this too.
  if (denied) return denied;

  const input = await context.request.json().catch(() => ({}));
  const recipe = recipeFrom(input ?? {});

  const problem = problemWith(recipe);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  try {
    // Plain INSERT, never INSERT OR REPLACE: a collision is reported, never silently overwritten.
    await context.env.DB.prepare('INSERT INTO recipes (slug, json, updated_at) VALUES (?, ?, ?)')
      .bind(recipe.slug, JSON.stringify(recipe), recipe.updatedAt)
      .run();
  } catch (error) {
    if (!/UNIQUE|constraint/i.test(error.message)) throw error;
    return Response.json({ error: `A recipe already exists at "${recipe.slug}". Give this one a different title.` }, { status: 409 });
  }

  return Response.json(recipe, { status: 201 });
};
