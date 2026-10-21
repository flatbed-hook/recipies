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

it('GET /api/recipes returns the seeded recipe', async () => {
  const response = await onRequestGet({ request: new Request('http://test/api/recipes'), env });

  expect(response.status).toBe(200);
  const recipes = await response.json();
  expect(recipes).toHaveLength(1);
  expect(recipes[0].slug).toBe('tabbouleh');
  expect(recipes[0].title).toBe('Tabbouleh');
  expect(recipes[0].tags).toEqual(['Salads']);
  expect(recipes[0].ingredients).toContain('3 tbsp fresh lemon juice');
  expect(recipes[0].steps).toHaveLength(3);
  expect(recipes[0].source.url).toBe('https://www.loveandlemons.com/tabbouleh/');
});

it('GET /api/recipes/:slug returns the single recipe', async () => {
  const response = await getRecipe({ request: new Request('http://test/api/recipes/tabbouleh'), params: { slug: 'tabbouleh' }, env });

  expect(response.status).toBe(200);
  const recipe = await response.json();
  expect(recipe.slug).toBe('tabbouleh');
  expect(recipe.title).toBe('Tabbouleh');
  expect(recipe.tags).toEqual(['Salads']);
  expect(recipe.ingredients).toHaveLength(12);
  expect(recipe.steps).toHaveLength(3);
  expect(recipe.notes).toContain('Coarse bulgur');
  expect(recipe.source.name).toBe('Love and Lemons');
});

it('GET /api/recipes/:slug returns not-found for an unknown slug', async () => {
  const response = await getRecipe({ request: new Request('http://test/api/recipes/no-such-recipe'), params: { slug: 'no-such-recipe' }, env });

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: 'Recipe not found' });
});
