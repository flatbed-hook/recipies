import { env } from 'cloudflare:test';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { onRequestPost as login } from '../functions/api/login.js';
import { onRequestGet as listRecipes, onRequestPost as createRecipe } from '../functions/api/recipes.js';
import { onRequestDelete as deleteRecipe, onRequestGet as getRecipe, onRequestPut as updateRecipe } from '../functions/api/recipes/[slug].js';
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

afterEach(() => vi.useRealTimers());

const bearer = () => ({ Authorization: `Bearer ${token}` });

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

// Every test starts from a recipe that already exists, the way an edit always does.
const given = async (overrides) => {
  const response = await createRecipe({
    request: new Request('http://test/api/recipes', { method: 'POST', headers: bearer(), body: JSON.stringify(complete(overrides)) }),
    env: authEnv,
  });
  return response.json();
};

const update = (slug, body, headers = bearer()) =>
  updateRecipe({
    request: new Request(`http://test/api/recipes/${slug}`, { method: 'PUT', headers, body: JSON.stringify(body) }),
    params: { slug },
    env: authEnv,
  });

const remove = (slug, headers = bearer()) =>
  deleteRecipe({ request: new Request(`http://test/api/recipes/${slug}`, { method: 'DELETE', headers }), params: { slug }, env: authEnv });

const read = (slug) => getRecipe({ request: new Request(`http://test/api/recipes/${slug}`), params: { slug }, env });

const listSlugs = async () => (await (await listRecipes({ request: new Request('http://test/api/recipes'), env })).json()).map((r) => r.slug);

// ---- Update replaces the whole object ----------------------------------------------------------

it('replaces every field, including added, removed and reordered tags', async () => {
  const original = await given({ title: 'Whole Object' });

  const response = await update('whole-object', {
    ...original,
    description: 'Rewritten.',
    tags: ['Make-ahead', 'Soups', 'Vegetarian'], // one dropped, two added, the survivor moved first
    servings: '8',
    prepTime: '5 min',
    cookTime: '',
    image: 'https://example.com/new.jpg',
    ingredients: ['3 tbsp lemon juice', '1 cup bulgur', '1 tsp salt'], // reordered, plus a new one
    steps: ['Mix everything.', 'Soak the bulgur.'], // reordered
    notes: 'Used half the lemon this time.',
    source: { url: 'https://example.com/other', name: 'Other' },
  });

  expect(response.status).toBe(200);
  const stored = await (await read('whole-object')).json();
  expect(stored).toEqual(await response.json());
  expect(stored).toMatchObject({
    title: 'Whole Object',
    description: 'Rewritten.',
    tags: ['Make-ahead', 'Soups', 'Vegetarian'],
    servings: '8',
    prepTime: '5 min',
    cookTime: '',
    image: 'https://example.com/new.jpg',
    ingredients: ['3 tbsp lemon juice', '1 cup bulgur', '1 tsp salt'],
    steps: ['Mix everything.', 'Soak the bulgur.'],
    notes: 'Used half the lemon this time.',
    source: { url: 'https://example.com/other', name: 'Other' },
  });
  expect(Object.keys(stored).sort()).toEqual(
    ['cookTime', 'description', 'image', 'ingredients', 'notes', 'prepTime', 'servings', 'slug', 'source', 'steps', 'tags', 'title', 'updatedAt'],
  );
});

it('clears a field that the writer emptied, rather than keeping the old value', async () => {
  const original = await given({ title: 'Emptied Fields' });

  await update('emptied-fields', { ...original, notes: '', image: '', tags: [], source: { url: '', name: '' } });

  expect(await (await read('emptied-fields')).json()).toMatchObject({ notes: '', image: '', tags: [], source: { url: '', name: '' } });
});

it('shows the edit immediately, both in the list and on the recipe', async () => {
  const original = await given({ title: 'Seen At Once' });

  await update('seen-at-once', { ...original, description: 'Changed.' });

  expect(await listSlugs()).toContain('seen-at-once');
  expect((await (await read('seen-at-once')).json()).description).toBe('Changed.');
});

// ---- Renaming keeps the slug -------------------------------------------------------------------

it('keeps the slug when the title changes, so shared links do not break', async () => {
  const original = await given({ title: 'Old Name' });

  const renamed = await (await update('old-name', { ...original, title: 'A Completely Different Name' })).json();

  expect(renamed.slug).toBe('old-name');
  expect(renamed.title).toBe('A Completely Different Name');
  expect((await (await read('old-name')).json()).title).toBe('A Completely Different Name');
  expect((await read('a-completely-different-name')).status).toBe(404);
  expect(await listSlugs()).not.toContain('a-completely-different-name');
});

it('ignores a slug smuggled in the body, since the URL is the identifier', async () => {
  const original = await given({ title: 'Stays Put' });

  const saved = await (await update('stays-put', { ...original, slug: 'somewhere-else' })).json();

  expect(saved.slug).toBe('stays-put');
  expect(await listSlugs()).not.toContain('somewhere-else');
});

// ---- Conflict detection ------------------------------------------------------------------------

it('refreshes updatedAt on every successful save, in the migrated ISO 8601 format', async () => {
  const original = await given({ title: 'Freshly Stamped' });
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse(original.updatedAt) + 90_000);

  const saved = await (await update('freshly-stamped', { ...original, notes: 'edited' })).json();

  expect(saved.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  expect(Date.parse(saved.updatedAt)).toBe(Date.parse(original.updatedAt) + 90_000);
  expect((await (await read('freshly-stamped')).json()).updatedAt).toBe(saved.updatedAt);
});

// The actual scenario: two phones open the same recipe, both edit, both press save.
it('rejects the second of two writers who opened the same version, and keeps the first edit', async () => {
  const opened = await given({ title: 'Two Phones' }); // what both writers loaded

  vi.useFakeTimers();
  vi.setSystemTime(Date.parse(opened.updatedAt) + 60_000);
  const first = await update('two-phones', { ...opened, notes: 'the first writer won' });
  expect(first.status).toBe(200);

  vi.setSystemTime(Date.parse(opened.updatedAt) + 120_000);
  const second = await update('two-phones', { ...opened, notes: 'the second writer clobbered it' });

  expect(second.status).toBe(409);
  expect((await second.json()).error).toMatch(/someone else saved this recipe/i);
  // The whole point: the first writer's change is still there.
  expect((await (await read('two-phones')).json()).notes).toBe('the first writer won');
});

it('rejects an update carrying a stale or missing updatedAt and stores nothing', async () => {
  const original = await given({ title: 'Stale Stamp', notes: 'untouched' });

  for (const updatedAt of ['2000-01-01T00:00:00Z', '', undefined, null, 'not a date', Date.parse(original.updatedAt)]) {
    const response = await update('stale-stamp', { ...original, updatedAt, notes: 'clobbered' });
    expect([response.status, (await response.json()).error]).toEqual([409, expect.stringMatching(/someone else saved this recipe/i)]);
  }

  expect((await (await read('stale-stamp')).json()).notes).toBe('untouched');
});

// ---- Delete ------------------------------------------------------------------------------------

it('deletes a recipe, and it is gone from the list and the recipe page at once', async () => {
  await given({ title: 'Duplicate Entry' });

  const response = await remove('duplicate-entry');

  expect(response.status).toBe(200);
  expect(await listSlugs()).not.toContain('duplicate-entry');
  expect((await read('duplicate-entry')).status).toBe(404);
});

it('reports not-found for an update or delete of a slug that does not exist', async () => {
  expect((await update('never-existed', complete({ updatedAt: '2026-01-01T00:00:00Z' }))).status).toBe(404);
  expect((await remove('never-existed')).status).toBe(404);
});

// ---- Authentication ----------------------------------------------------------------------------

const BAD_HEADERS = [{}, { Authorization: 'Bearer wrong' }, { Authorization: `Bearer ${'a'.repeat(64)}` }, { Authorization: 'bogus' }];

it('rejects an update with no valid token and changes nothing', async () => {
  const original = await given({ title: 'Guarded Edit', notes: 'untouched' });

  for (const headers of BAD_HEADERS) {
    const response = await update('guarded-edit', { ...original, notes: 'smuggled in' }, headers);
    expect(response.status).toBe(401);
  }

  expect((await (await read('guarded-edit')).json()).notes).toBe('untouched');
});

it('rejects a delete with no valid token and leaves the recipe in place', async () => {
  await given({ title: 'Guarded Delete' });

  for (const headers of BAD_HEADERS) expect((await remove('guarded-delete', headers)).status).toBe(401);

  expect(await listSlugs()).toContain('guarded-delete');
});

// ---- Validation still applies on the way in ----------------------------------------------------

it('refuses to empty out a stored recipe through an update', async () => {
  const original = await given({ title: 'Keeps Its Content' });

  expect((await update('keeps-its-content', { ...original, title: '' })).status).toBe(400);
  expect((await update('keeps-its-content', { ...original, ingredients: [] })).status).toBe(400);
  expect((await update('keeps-its-content', { ...original, steps: [] })).status).toBe(400);
  expect((await update('keeps-its-content', 'not even an object')).status).toBe(400);

  expect(await (await read('keeps-its-content')).json()).toEqual(original);
});

it('drops unknown keys and non-http URLs on update, the same as on create', async () => {
  const original = await given({ title: 'Sneaky Edit' });

  const saved = await (await update('sneaky-edit', { ...original, evil: 'DROP TABLE', image: 'javascript:alert(1)', source: { url: 'javascript:alert(1)', name: 'x' } })).json();

  expect(saved).not.toHaveProperty('evil');
  expect(saved.image).toBe('');
  expect(saved.source).toEqual({ url: '', name: 'x' });
});

// A rename is free of the create-time slug rule: nothing has to be derived from the new title.
it('allows a rename to a title with no Latin letters, since the slug is already fixed', async () => {
  const original = await given({ title: 'Cheesecake' });

  const saved = await (await update('cheesecake', { ...original, title: 'עוגת גבינה' })).json();

  expect(saved).toMatchObject({ slug: 'cheesecake', title: 'עוגת גבינה' });
});
