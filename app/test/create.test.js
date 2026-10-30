import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { onRequest as middleware } from '../functions/_middleware.js';
import { onRequestPost as login } from '../functions/api/login.js';
import { onRequestGet as listRecipes, onRequestPost as createRecipe } from '../functions/api/recipes.js';
import { onRequestGet as getRecipe } from '../functions/api/recipes/[slug].js';
import schema from '../schema.sql?raw';

const PASSWORD = 'correct horse battery staple';
const authEnv = { ...env, EDIT_PASSWORD: PASSWORD };

let token;

beforeAll(async () => {
  await env.DB.exec(schema.trim());
  const response = await login({
    request: new Request('http://test/api/login', { method: 'POST', body: JSON.stringify({ password: PASSWORD }) }),
    env: authEnv,
  });
  token = (await response.json()).token;
});

const complete = (overrides) => ({
  title: 'Test Recipe',
  description: 'A recipe for testing.',
  tags: ['Salads', 'Make-ahead'],
  servings: '4',
  prepTime: '20 min',
  cookTime: '10 min',
  image: 'https://example.com/photo.jpg',
  ingredients: ['1 cup bulgur', '3 tbsp lemon juice'],
  steps: ['Soak the bulgur.', 'Mix everything.'],
  notes: 'Better the next day.',
  source: { url: 'https://example.com/recipe', name: 'Example' },
  ...overrides,
});

const create = (body, headers = { Authorization: `Bearer ${token}` }) =>
  createRecipe({
    request: new Request('http://test/api/recipes', { method: 'POST', headers, body: JSON.stringify(body) }),
    env: authEnv,
  });

const read = (slug) => getRecipe({ request: new Request(`http://test/api/recipes/${slug}`), params: { slug }, env });

const listSlugs = async () => (await (await listRecipes({ request: new Request('http://test/api/recipes'), env })).json()).map((r) => r.slug);

it('creates a recipe, and reading it back returns what was written', async () => {
  const response = await create(complete({ title: 'Creamy Tomato Soup' }));

  expect(response.status).toBe(201);
  const created = await response.json();
  expect(created.slug).toBe('creamy-tomato-soup');

  const stored = await (await read('creamy-tomato-soup')).json();
  expect(stored).toEqual(created);
  expect(stored).toMatchObject({
    title: 'Creamy Tomato Soup',
    description: 'A recipe for testing.',
    tags: ['Salads', 'Make-ahead'],
    servings: '4',
    prepTime: '20 min',
    cookTime: '10 min',
    image: 'https://example.com/photo.jpg',
    ingredients: ['1 cup bulgur', '3 tbsp lemon juice'],
    steps: ['Soak the bulgur.', 'Mix everything.'],
    notes: 'Better the next day.',
    source: { url: 'https://example.com/recipe', name: 'Example' },
  });
});

// Migrated and hand-created recipes have to stay interchangeable: the detail page reads all 13 keys.
it('stores all 13 keys, using "" for what the writer left blank', async () => {
  const response = await create({ title: 'Bare Minimum Bread', ingredients: ['flour'], steps: ['bake'] });

  const created = await response.json();
  expect(Object.keys(created).sort()).toEqual(
    ['cookTime', 'description', 'image', 'ingredients', 'notes', 'prepTime', 'servings', 'slug', 'source', 'steps', 'tags', 'title', 'updatedAt'],
  );
  expect(created).toMatchObject({ description: '', servings: '', prepTime: '', cookTime: '', image: '', notes: '', tags: [], source: { url: '', name: '' } });
});

it('sets updatedAt on save, in the same ISO 8601 format as the migrated records', async () => {
  const before = Date.now();
  const created = await (await create(complete({ title: 'Timed Toast' }))).json();

  expect(created.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  expect(Date.parse(created.updatedAt)).toBeGreaterThanOrEqual(before - 1000);
});

it('shows the new recipe in the list immediately after saving', async () => {
  await create(complete({ title: 'Instant Noodles' }));

  expect(await listSlugs()).toContain('instant-noodles');
});

it('derives the slug from the title: lowercase, accents and punctuation dropped, spaces to hyphens', async () => {
  const slugOf = async (title) => (await (await create(complete({ title }))).json()).slug;

  expect(await slugOf('Chicken Soup + Stock')).toBe('chicken-soup-stock');
  expect(await slugOf("Honey Roasted Za'atar Chicken")).toBe('honey-roasted-zaatar-chicken');
  expect(await slugOf('Feta Tzatziki & Roasted Bell Peppers')).toBe('feta-tzatziki-roasted-bell-peppers');
  expect(await slugOf('Sheet-Pan Chicken')).toBe('sheet-pan-chicken');
  expect(await slugOf('  Jalapeño Poppers!  ')).toBe('jalapeno-poppers');
});

it('reports a duplicate slug instead of overwriting the existing recipe', async () => {
  await create(complete({ title: 'Potato Kugel', notes: 'the original' }));

  const response = await create(complete({ title: 'Potato Kugel', notes: 'the impostor' }));

  expect(response.status).toBe(409);
  expect((await response.json()).error).toMatch(/already exists/i);
  expect((await (await read('potato-kugel')).json()).notes).toBe('the original');
});

it('rejects a create with no valid token and stores nothing', async () => {
  for (const headers of [{}, { Authorization: 'Bearer wrong' }, { Authorization: `Bearer ${'a'.repeat(64)}` }, { Authorization: 'bogus' }]) {
    const response = await create(complete({ title: 'Smuggled Scones' }), headers);
    expect(response.status).toBe(401);
  }

  expect(await listSlugs()).not.toContain('smuggled-scones');
});

it('rejects a recipe with no usable title, ingredients, or steps', async () => {
  expect((await create(complete({ title: '' }))).status).toBe(400);
  expect((await create(complete({ title: '!!!' }))).status).toBe(400);
  expect((await create(complete({ title: 'No Food', ingredients: [], steps: [] }))).status).toBe(400);
  expect((await create(complete({ title: 'No Steps', steps: [] }))).status).toBe(400);
});

// Untrusted input: the detail page renders source.url as a link href and image as an img src.
it('drops unknown keys and non-http URLs rather than storing them', async () => {
  const created = await (await create(
    complete({ title: 'Sneaky Salad', evil: 'DROP TABLE', slug: 'somewhere-else', image: 'javascript:alert(1)', source: { url: 'javascript:alert(1)', name: 'x' } }),
  )).json();

  expect(created.slug).toBe('sneaky-salad');
  expect(created).not.toHaveProperty('evil');
  expect(created.image).toBe('');
  expect(created.source).toEqual({ url: '', name: 'x' });
});

// ---- Deny by default --------------------------------------------------------------------------
// requireAuth is opt-in, so a future write endpoint is one forgotten call away from being open.
// The middleware is what closes that, and POST /api/login is the one hole it must leave.

const through = async (method, path, headers) => {
  let reached = false;
  const response = await middleware({
    request: new Request(`http://test${path}`, { method, headers, body: method === 'GET' ? undefined : '{}' }),
    env: authEnv,
    next: async () => ((reached = true), new Response('downstream')),
  });
  return { reached, status: response.status };
};

it('lets POST /api/login through without a token, or nobody could ever log in', async () => {
  expect(await through('POST', '/api/login', {})).toEqual({ reached: true, status: 200 });
});

it('lets every GET through without a token, so reading stays public', async () => {
  expect(await through('GET', '/api/recipes', {})).toEqual({ reached: true, status: 200 });
  expect(await through('GET', '/api/recipes/tabbouleh', {})).toEqual({ reached: true, status: 200 });
  expect(await through('GET', '/', {})).toEqual({ reached: true, status: 200 });
});

it('blocks any other write without a valid token, including endpoints that do not exist yet', async () => {
  for (const [method, path] of [
    ['POST', '/api/recipes'],
    ['PUT', '/api/recipes/tabbouleh'],
    ['DELETE', '/api/recipes/tabbouleh'],
    ['POST', '/api/extract'],
    ['POST', '/api/not-written-yet'],
    ['PUT', '/api/login'], // the exemption is for the POST, not the whole path
  ])
    expect(await through(method, path, { Authorization: 'Bearer nope' })).toEqual({ reached: false, status: 401 });

  expect(await through('POST', '/api/recipes', {})).toEqual({ reached: false, status: 401 });
});

it('lets a write with a valid token through to the endpoint', async () => {
  expect(await through('POST', '/api/recipes', { Authorization: `Bearer ${token}` })).toEqual({ reached: true, status: 200 });
});
