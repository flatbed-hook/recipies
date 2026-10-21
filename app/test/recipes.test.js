import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { onRequestGet } from '../functions/api/recipes.js';
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
