import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { onRequestGet } from '../functions/api/recipes.js';
import schema from '../schema.sql?raw';
import seed from '../seed.sql?raw';

beforeAll(async () => {
  await env.DB.exec(schema.trim());
  await env.DB.exec(seed.trim());
});

const get = async () => (await onRequestGet({ request: new Request('http://test/api/recipes'), env })).json();

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
