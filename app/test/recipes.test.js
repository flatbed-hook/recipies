import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { onRequestGet } from '../functions/api/recipes.js';
import { onRequestGet as getRecipe } from '../functions/api/recipes/[slug].js';
import schema from '../schema.sql?raw';
import seed from '../seed.sql?raw';

// Migrated recipes carry every key, using '' for what the old site did not have.
const sparse = {
  slug: 'meat-pillows', title: 'Meat Pillows', description: '', tags: ['Other'],
  servings: '4', prepTime: 'Not specified', cookTime: '', image: '',
  ingredients: ['1 lb ground beef'], steps: ['Cook them.'], notes: '',
  source: { url: '', name: '' }, updatedAt: '2026-10-20T12:00:00Z',
};

beforeAll(async () => {
  await env.DB.exec(schema.trim());
  await env.DB.exec(seed.trim());
  await env.DB.prepare('INSERT OR REPLACE INTO recipes (slug, json, updated_at) VALUES (?, ?, ?)')
    .bind(sparse.slug, JSON.stringify(sparse), sparse.updatedAt).run();
});

it('GET /api/recipes returns the seeded recipe', async () => {
  const response = await onRequestGet({ request: new Request('http://test/api/recipes'), env });

  expect(response.status).toBe(200);
  const recipes = await response.json();
  const tabbouleh = recipes.find((recipe) => recipe.slug === 'tabbouleh');
  expect(tabbouleh.title).toBe('Tabbouleh');
  expect(tabbouleh.tags).toEqual(['Salads']);
  expect(tabbouleh.ingredients).toContain('3 tbsp fresh lemon juice');
  expect(tabbouleh.steps).toHaveLength(3);
  expect(tabbouleh.source.url).toBe('https://www.loveandlemons.com/tabbouleh/');
});

it('GET /api/recipes/:slug returns the single recipe', async () => {
  const response = await getRecipe({ request: new Request('http://test/api/recipes/tabbouleh'), params: { slug: 'tabbouleh' }, env });

  expect(response.status).toBe(200);
  const recipe = await response.json();
  expect(recipe.slug).toBe('tabbouleh');
  expect(recipe.title).toBe('Tabbouleh');
  expect(recipe.steps).toHaveLength(3);
  expect(recipe.notes).toContain('Coarse bulgur');
});

it('GET /api/recipes/:slug keeps absent fields as empty strings the page can skip', async () => {
  const response = await getRecipe({ request: new Request('http://test/api/recipes/meat-pillows'), params: { slug: 'meat-pillows' }, env });

  expect(response.status).toBe(200);
  const recipe = await response.json();
  expect(recipe).toEqual(sparse);
  expect(recipe.description).toBe('');
  expect(recipe.notes).toBe('');
  expect(recipe.image).toBe('');
  expect(recipe.source).toEqual({ url: '', name: '' });
  expect(recipe.prepTime).toBe('Not specified');
});

it('GET /api/recipes/:slug returns not-found for an unknown slug', async () => {
  const response = await getRecipe({ request: new Request('http://test/api/recipes/no-such-recipe'), params: { slug: 'no-such-recipe' }, env });

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: 'Recipe not found' });
});
