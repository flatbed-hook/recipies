import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { onRequestGet } from '../functions/api/recipes.js';
import { onRequestGet as getRecipe } from '../functions/api/recipes/[slug].js';
import schema from '../schema.sql?raw';
import seed from '../seed.sql?raw';

beforeAll(async () => {
  await env.DB.exec(schema.trim());
  await env.DB.exec(seed.trim());
});

const get = async () => (await onRequestGet({ request: new Request('http://test/api/recipes'), env })).json();
const getOne = (slug) => getRecipe({ request: new Request(`http://test/api/recipes/${slug}`), params: { slug }, env });

it('GET /api/recipes returns all 16 migrated recipes, each complete', async () => {
  const recipes = await get();

  expect(recipes).toHaveLength(16);
  for (const r of recipes) {
    expect(r.slug).toMatch(/^[a-z0-9-]+$/);
    expect(r.title).toBeTruthy();
    expect(r.tags[0]).toBeTruthy();
    expect(r.ingredients.length).toBeGreaterThan(0);
    expect(r.steps.length).toBeGreaterThan(0);
    expect(Object.keys(r).sort()).toEqual(
      ['cookTime', 'description', 'image', 'ingredients', 'notes', 'prepTime', 'servings', 'slug', 'source', 'steps', 'tags', 'title', 'updatedAt'],
    );
  }
  expect([...new Set(recipes.map((r) => r.tags[0]))].sort()).toEqual(['Baking', 'Other', 'Salads', 'Soups', 'Vegetarian']);
});

it('carries every field across for a recipe that has them all', async () => {
  const tabbouleh = (await get()).find((r) => r.slug === 'tabbouleh');

  expect(tabbouleh.title).toBe('Tabbouleh');
  expect(tabbouleh.tags).toEqual(['Salads']);
  expect(tabbouleh.servings).toBe('6');
  expect(tabbouleh.prepTime).toBe('20 min');
  expect(tabbouleh.cookTime).toBe('20 min');
  expect(tabbouleh.ingredients).toContain('3 tbsp fresh lemon juice');
  expect(tabbouleh.steps).toHaveLength(3);
  expect(tabbouleh.notes).toMatch(/^Coarse bulgur/);
  expect(tabbouleh.source).toEqual({ url: 'https://www.loveandlemons.com/tabbouleh/', name: 'Love and Lemons' });
});

it('leaves absent fields empty rather than dropping them', async () => {
  const recipes = await get();

  expect(recipes.find((r) => r.slug === 'potato-kugel')).toMatchObject({ description: '', notes: '', source: { url: '', name: '' } });
  expect(recipes.find((r) => r.slug === 'peach-cobbler').source).toEqual({ url: '', name: 'preppykitchen.com' });
});

it('GET /api/recipes/:slug returns the single recipe', async () => {
  const response = await getOne('tabbouleh');

  expect(response.status).toBe(200);
  const recipe = await response.json();
  expect(recipe.slug).toBe('tabbouleh');
  expect(recipe.title).toBe('Tabbouleh');
  expect(recipe.steps).toHaveLength(3);
  expect(recipe.notes).toContain('Coarse bulgur');
});

// The detail page skips empty fields rather than rendering blank rows, so the endpoint
// must hand them over intact. potato-kugel is the real migrated recipe that has them.
it('GET /api/recipes/:slug keeps absent fields as empty strings the page can skip', async () => {
  const response = await getOne('potato-kugel');

  expect(response.status).toBe(200);
  const recipe = await response.json();
  expect(recipe.description).toBe('');
  expect(recipe.notes).toBe('');
  expect(recipe.image).toBe('');
  expect(recipe.source).toEqual({ url: '', name: '' });
  expect(recipe.prepTime).toBe('Not specified');
});

it('GET /api/recipes/:slug returns not-found for an unknown slug', async () => {
  const response = await getOne('no-such-recipe');

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: 'Recipe not found' });
});
