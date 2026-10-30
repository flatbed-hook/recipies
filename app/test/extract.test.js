import { env } from 'cloudflare:test';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { onRequest as middleware } from '../functions/_middleware.js';
import { onRequestPost as extract } from '../functions/api/extract.js';
import { onRequestPost as login } from '../functions/api/login.js';
import { onRequestGet as listRecipes } from '../functions/api/recipes.js';
import schema from '../schema.sql?raw';

const PASSWORD = 'correct horse battery staple';
const authEnv = { ...env, EDIT_PASSWORD: PASSWORD };
const SOURCE = 'https://www.example-kitchen.com/recipes/tabbouleh';

let token;

beforeAll(async () => {
  await env.DB.exec(schema.trim());
  const response = await login({
    request: new Request('http://test/api/login', { method: 'POST', body: JSON.stringify({ password: PASSWORD }) }),
    env: authEnv,
  });
  token = (await response.json()).token;
});

afterEach(() => vi.unstubAllGlobals());

// The suite must never touch a live recipe site, so every test serves its page from here.
const serve = (body, { status = 200, type = 'text/html; charset=utf-8' } = {}) => {
  const stub = vi.fn(async () => new Response(body, { status, headers: { 'content-type': type } }));
  vi.stubGlobal('fetch', stub);
  return stub;
};

const page = (...blocks) =>
  `<!DOCTYPE html><html><head><meta property="og:site_name" content="Example Kitchen">` +
  blocks.map((block) => `<script type="application/ld+json">${JSON.stringify(block)}</script>`).join('') +
  `</head><body><h1>Tabbouleh</h1></body></html>`;

const recipeLd = (overrides) => ({
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: 'Tabbouleh',
  description: 'A bright parsley salad.',
  recipeIngredient: ['1 cup bulgur', '3 tbsp lemon juice'],
  recipeInstructions: ['Soak the bulgur.', 'Mix everything.'],
  ...overrides,
});

const post = (body, headers = { Authorization: `Bearer ${token}` }) =>
  extract({ request: new Request('http://test/api/extract', { method: 'POST', headers, body: JSON.stringify(body) }), env: authEnv });

const extracted = async (ld, html) => {
  serve(html ?? page(ld));
  const response = await post({ url: SOURCE });
  expect(response.status).toBe(200);
  return response.json();
};

const listSlugs = async () => (await (await listRecipes({ request: new Request('http://test/api/recipes'), env })).json()).map((r) => r.slug);

it('turns a page with Recipe JSON-LD into a complete recipe record', async () => {
  const recipe = await extracted(recipeLd({ recipeYield: '4 servings', recipeCategory: 'Salads', recipeCuisine: 'Levantine' }));

  expect(recipe).toMatchObject({
    slug: 'tabbouleh',
    title: 'Tabbouleh',
    description: 'A bright parsley salad.',
    tags: ['Salads', 'Levantine'],
    servings: '4 servings',
    ingredients: ['1 cup bulgur', '3 tbsp lemon juice'],
    steps: ['Soak the bulgur.', 'Mix everything.'],
  });
  // The same 13 keys as a hand-created recipe, so the form and the create endpoint see one shape.
  expect(Object.keys(recipe).sort()).toEqual(
    ['cookTime', 'description', 'image', 'ingredients', 'notes', 'prepTime', 'servings', 'slug', 'source', 'steps', 'tags', 'title', 'updatedAt'],
  );
});

it('captures the source URL and the site name without being asked', async () => {
  expect((await extracted(recipeLd())).source).toEqual({ url: SOURCE, name: 'Example Kitchen' });
});

it("takes tags from the site's own category and cuisine, in either shape, and ignores junk", async () => {
  const tagsOf = async (overrides) => (await extracted(recipeLd(overrides))).tags;

  expect(await tagsOf({ recipeCategory: ['Salads', 'Side Dish'], recipeCuisine: 'Levantine, Middle Eastern' })).toEqual(['Salads', 'Side Dish', 'Levantine', 'Middle Eastern']);
  expect(await tagsOf({ recipeCategory: { '@type': 'Thing', name: 'Salads' } })).toEqual([]);
  expect(await tagsOf({})).toEqual([]);
});

it('falls back to the hostname when the page declares no site name', async () => {
  const html = page(recipeLd()).replace(/<meta[^>]*og:site_name[^>]*>/, '');

  expect((await extracted(null, html)).source).toEqual({ url: SOURCE, name: 'example-kitchen.com' });
});

// ---- Normalisation 1: instructions -------------------------------------------------------------

it('flattens instructions given as one string', async () => {
  const recipe = await extracted(recipeLd({ recipeInstructions: 'Soak the bulgur.\nChop the parsley.\n\nMix everything.' }));

  expect(recipe.steps).toEqual(['Soak the bulgur.', 'Chop the parsley.', 'Mix everything.']);
});

it('flattens instructions given as one string of HTML', async () => {
  const recipe = await extracted(recipeLd({ recipeInstructions: '<p>Soak the <b>bulgur</b>.</p><p>Mix everything &amp; serve.</p>' }));

  expect(recipe.steps).toEqual(['Soak the bulgur.', 'Mix everything & serve.']);
});

it('flattens instructions given as an array of strings', async () => {
  const recipe = await extracted(recipeLd({ recipeInstructions: ['Soak the bulgur.', 'Mix everything.'] }));

  expect(recipe.steps).toEqual(['Soak the bulgur.', 'Mix everything.']);
});

it('flattens instructions given as HowToStep objects', async () => {
  const recipe = await extracted(
    recipeLd({
      recipeInstructions: [
        { '@type': 'HowToStep', name: 'Soak', text: 'Soak the bulgur.', url: 'https://example.com/#step1' },
        { '@type': 'HowToStep', text: 'Mix everything.' },
      ],
    }),
  );

  expect(recipe.steps).toEqual(['Soak the bulgur.', 'Mix everything.']);
});

it('flattens instructions nested in HowToSection groups', async () => {
  const recipe = await extracted(
    recipeLd({
      recipeInstructions: [
        { '@type': 'HowToSection', name: 'Salad', itemListElement: [{ '@type': 'HowToStep', text: 'Soak the bulgur.' }, { '@type': 'HowToStep', text: 'Chop the parsley.' }] },
        { '@type': 'HowToSection', name: 'Dressing', itemListElement: [{ '@type': 'HowToStep', text: 'Whisk the lemon juice.' }] },
      ],
    }),
  );

  expect(recipe.steps).toEqual(['Soak the bulgur.', 'Chop the parsley.', 'Whisk the lemon juice.']);
});

it('falls back to a step with a name but no text, rather than dropping it', async () => {
  const recipe = await extracted(recipeLd({ recipeInstructions: [{ '@type': 'HowToStep', name: 'Soak the bulgur.' }] }));

  expect(recipe.steps).toEqual(['Soak the bulgur.']);
});

// ---- Normalisation 2: durations ----------------------------------------------------------------

it('turns ISO-8601 durations into the time style the existing recipes use', async () => {
  const timeOf = async (iso) => (await extracted(recipeLd({ prepTime: iso }))).prepTime;

  expect(await timeOf('PT20M')).toBe('20 min');
  expect(await timeOf('PT1H')).toBe('1 hr');
  expect(await timeOf('PT1H30M')).toBe('1 hr 30 min');
  expect(await timeOf('P0DT1H15M')).toBe('1 hr 15 min');
  expect(await timeOf('P1DT2H')).toBe('26 hr');
});

it('normalises prepTime and cookTime the same way, and leaves an absent one blank', async () => {
  const recipe = await extracted(recipeLd({ prepTime: 'PT20M', cookTime: 'PT1H45M' }));

  expect(recipe).toMatchObject({ prepTime: '20 min', cookTime: '1 hr 45 min' });
  expect((await extracted(recipeLd())).prepTime).toBe('');
});

it('keeps a time that is prose rather than a duration, instead of losing it', async () => {
  expect((await extracted(recipeLd({ cookTime: 'about 30 minutes' }))).cookTime).toBe('about 30 minutes');
});

// ---- Normalisation 3: images -------------------------------------------------------------------

it('flattens an image given as a string', async () => {
  expect((await extracted(recipeLd({ image: 'https://example.com/photo.jpg' }))).image).toBe('https://example.com/photo.jpg');
});

it('flattens an image given as an ImageObject', async () => {
  const recipe = await extracted(recipeLd({ image: { '@type': 'ImageObject', url: 'https://example.com/photo.jpg', width: 1200 } }));

  expect(recipe.image).toBe('https://example.com/photo.jpg');
});

it('flattens an image given as an array of strings', async () => {
  const recipe = await extracted(recipeLd({ image: ['https://example.com/photo.jpg', 'https://example.com/square.jpg'] }));

  expect(recipe.image).toBe('https://example.com/photo.jpg');
});

it('flattens an image given as an array of ImageObjects', async () => {
  const recipe = await extracted(recipeLd({ image: [{ '@type': 'ImageObject', url: 'https://example.com/photo.jpg' }] }));

  expect(recipe.image).toBe('https://example.com/photo.jpg');
});

it('drops an image URL that is not http(s), since the recipe page renders it as an img src', async () => {
  expect((await extracted(recipeLd({ image: 'javascript:alert(1)' }))).image).toBe('');
});

// ---- Selecting the Recipe node -----------------------------------------------------------------

it('finds the Recipe among several JSON-LD blocks on one page', async () => {
  const recipe = await extracted(null, page({ '@type': 'Organization', name: 'Example Kitchen' }, { '@type': 'BreadcrumbList' }, recipeLd()));

  expect(recipe.title).toBe('Tabbouleh');
});

it('finds a Recipe nested inside an @graph', async () => {
  const recipe = await extracted({ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage' }, recipeLd()] });

  expect(recipe.title).toBe('Tabbouleh');
});

it('finds a Recipe whose @type is an array', async () => {
  const recipe = await extracted(recipeLd({ '@type': ['Recipe', 'NewsArticle'] }));

  expect(recipe.title).toBe('Tabbouleh');
});

it('ignores a malformed JSON-LD block instead of giving up on the page', async () => {
  const html = `<html><head><script type="application/ld+json">{ not json </script><script type="application/ld+json">${JSON.stringify(recipeLd())}</script></head><body></body></html>`;

  expect((await extracted(null, html)).title).toBe('Tabbouleh');
});

// ---- Failure -----------------------------------------------------------------------------------

const failure = async (body, options) => {
  serve(body, options);
  const response = await post({ url: SOURCE });
  return { status: response.status, error: (await response.json()).error };
};

it('tells the writer to paste it by hand when the page has no recipe markup, and stores nothing', async () => {
  const before = await listSlugs();

  const { status, error } = await failure('<html><head><title>Tabbouleh</title></head><body><p>A life story.</p></body></html>');

  expect(status).toBe(422);
  expect(error).toMatch(/by hand/i);
  expect(await listSlugs()).toEqual(before);
});

it('gives the same paste-by-hand message when the JSON-LD has no Recipe node', async () => {
  const { status, error } = await failure(page({ '@type': 'Article', name: 'How I learned to love parsley' }));

  expect(status).toBe(422);
  expect(error).toMatch(/by hand/i);
});

it('gives the same message when a Recipe node has neither ingredients nor steps', async () => {
  const { status, error } = await failure(page({ '@type': 'Recipe', name: 'Tabbouleh' }));

  expect(status).toBe(422);
  expect(error).toMatch(/by hand/i);
});

it('refuses a page that is not HTML rather than parsing it', async () => {
  expect(await failure('%PDF-1.4', { type: 'application/pdf' })).toMatchObject({ status: 422 });
});

it('reports a page that could not be fetched, without throwing', async () => {
  expect((await failure('Not found', { status: 404 })).error).toMatch(/could not be fetched/i);

  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
  expect((await post({ url: SOURCE })).status).toBe(502);
});

it('rejects anything that is not an http(s) link before fetching it', async () => {
  const stub = serve(page(recipeLd()));

  for (const url of [undefined, '', 'not a url', 'javascript:alert(1)', 'file:///etc/passwd', 42]) {
    const response = await post({ url });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/http/i);
  }
  expect(stub).not.toHaveBeenCalled();
});

// ---- Behaviour the ticket requires of the request itself ---------------------------------------

it('sends a normal browser User-Agent, since some sites reject the default one', async () => {
  const stub = serve(page(recipeLd()));

  await post({ url: SOURCE });

  expect(stub).toHaveBeenCalledWith(SOURCE, expect.objectContaining({ headers: expect.objectContaining({ 'User-Agent': expect.stringMatching(/^Mozilla\/5\.0 .*Chrome/) }) }));
});

it('requires a valid token, and fetches nothing without one', async () => {
  const stub = serve(page(recipeLd()));

  for (const headers of [{}, { Authorization: 'Bearer wrong' }, { Authorization: 'bogus' }])
    expect((await post({ url: SOURCE }, headers)).status).toBe(401);

  expect(stub).not.toHaveBeenCalled();
});

it('is shut by the deny-by-default middleware before the handler is even reached', async () => {
  let reached = false;
  const response = await middleware({
    request: new Request('http://test/api/extract', { method: 'POST', body: '{}' }),
    env: authEnv,
    next: async () => ((reached = true), new Response('downstream')),
  });

  expect({ reached, status: response.status }).toEqual({ reached: false, status: 401 });
});

// ── Regressions found by code review of 80e227b ───────────────────────────────

it('does not resolve entity names up the prototype chain', async () => {
  // ENTITIES was a plain object, so "&constructor;" returned Object's source and spliced it
  // into the recipe text. Any page containing that literal was corrupted.
  const recipe = await extracted(recipeLd({ description: 'Mix &constructor; well' }));
  expect(recipe.description).toBe('Mix &constructor; well');
  expect(recipe.description).not.toMatch(/native code/);
});

it('treats a zero or seconds-bearing duration as unset rather than printing it raw', async () => {
  // PT0S is what recipe plugins emit for a time that was never filled in.
  const zero = await extracted(recipeLd({ prepTime: 'PT0S', cookTime: 'PT1H30M0S' }));
  expect(zero.prepTime).toBe('');
  expect(zero.cookTime).toBe('1 hr 30 min');
  const week = await extracted(recipeLd({ prepTime: 'P1W' }));
  expect(week.prepTime).toBe('168 hr');
  const seconds = await extracted(recipeLd({ prepTime: 'PT45S' }));
  expect(seconds.prepTime).toBe('');
});

it('falls back to a step name when its text is present but empty', async () => {
  const recipe = await extracted(
    recipeLd({ recipeInstructions: [{ '@type': 'HowToStep', text: '', name: 'Soak the bulgur.' }] }),
  );
  expect(recipe.steps).toEqual(['Soak the bulgur.']);
});

it('resolves relative and protocol-relative image URLs against the page', async () => {
  expect((await extracted(recipeLd({ image: '/uploads/photo.jpg' }))).image)
    .toBe('https://www.example-kitchen.com/uploads/photo.jpg');
  expect((await extracted(recipeLd({ image: '//cdn.example.com/photo.jpg' }))).image)
    .toBe('https://cdn.example.com/photo.jpg');
  expect((await extracted(recipeLd({ image: 'javascript:alert(1)' }))).image).toBe('');
});

it('does not eat a legitimate space before a closing parenthesis', async () => {
  const recipe = await extracted(recipeLd({ recipeInstructions: ['Serve with pita ( warmed ) .'] }));
  expect(recipe.steps).toEqual(['Serve with pita ( warmed ).']);
});
