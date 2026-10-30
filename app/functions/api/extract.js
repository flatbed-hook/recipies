import { requireAuth } from './login.js';
import { recipeFrom } from './recipes.js';

// Some sites 403 anything that looks like a bot, so we present as an ordinary desktop browser.
const BROWSER = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

// The one failure message. Every unextractable page gets this and nothing more specific, because
// the writer's next move is the same in every case: paste it in by hand. No LLM, no scraping
// fallback — a page without machine-readable markup is an accepted limitation, not a bug.
const BY_HAND = 'No recipe markup was found on that page. Paste the recipe in by hand below instead.';

const ENTITIES = { __proto__: null, amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const entity = (match, name) => {
  if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? match;
  const code = Number(name.slice(1).replace(/^x/i, '0x'));
  return code <= 0x10ffff ? String.fromCodePoint(code) : match; // &#99999999; must not throw.
};

// Third-party HTML. Markup is stripped rather than escaped, so only plain text reaches the form —
// instruction text routinely arrives wrapped in <p> and <a>, and entities leak out of WordPress.
const text = (value) =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value)
        .replace(/<[^>]*>/g, ' ')
        .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, entity)
        .replace(/\s+/g, ' ')
        .replace(/ ([.,;:!?])/g, '$1') // A stripped <b> inside a sentence must not leave "bulgur ."
        .trim()
    : '';

const first = (value) => (Array.isArray(value) ? first(value[0]) : value);

// --- the three normalisations -------------------------------------------------------------------

// Instructions arrive as a string, an array of strings, an array of HowToStep, or HowToSections
// nesting either. One recursion flattens all of them; a lone string splits on its line breaks,
// which is how sites that use one blob separate their steps.
const lines = (value) => {
  if (Array.isArray(value)) return value.flatMap(lines);
  if (value && typeof value === 'object') return lines(value.itemListElement || value.text || value.name || '');
  if (typeof value === 'string') return value.split(/<\/(?:p|li|div)>|<br\s*\/?>|[\r\n]+/i).map(text).filter(Boolean);
  return [];
};

// ISO-8601 durations become the style the 16 migrated recipes already use: "20 min", "1 hr 15 min".
// Anything that is not a duration is kept as text — plenty of sites put "about 30 minutes" in here.
const duration = (value) => {
  const parts = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(text(value).toUpperCase());
  if (!parts) return text(value);
  const [weeks, days, hours, minutes] = parts.slice(1).map(Number);
  const hr = (weeks || 0) * 168 + (days || 0) * 24 + (hours || 0);
  // Seconds are deliberately not rendered: PT0S means "unset", and no recipe times a step to the second.
  return [hr && `${hr} hr`, minutes && `${minutes} min`].filter(Boolean).join(' ');
};

// image is a string, an ImageObject, or an array of either. recipeFrom drops anything not http(s),
// so a site publishing "/uploads/photo.jpg" or "//cdn/photo.jpg" would silently lose its picture —
// resolve against the page URL first.
const image = (value, base) => {
  const one = first(value);
  const raw = typeof one === 'string' ? one : text(one?.url);
  try {
    return raw ? new URL(raw, base).href : '';
  } catch {
    return '';
  }
};

// --- JSON-LD ------------------------------------------------------------------------------------

const SCRIPTS = /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;

// A page can carry several blocks, and the Recipe is routinely one node inside an @graph.
function* nodes(value) {
  if (Array.isArray(value)) for (const item of value) yield* nodes(item);
  else if (value && typeof value === 'object') {
    yield value;
    yield* nodes(value['@graph']);
  }
}

const isRecipe = (node) => [].concat(node['@type'] ?? []).some((type) => String(type).toLowerCase() === 'recipe');

const recipeNode = (html) =>
  [...html.matchAll(SCRIPTS)]
    .flatMap((match) => {
      try {
        return [...nodes(JSON.parse(match[1]))];
      } catch {
        return []; // One malformed block must not hide a good one further down the page.
      }
    })
    .find(isRecipe);

// Tags come free: the site's own category and cuisine match how the 16 migrated recipes are tagged.
// Either can be an array or one comma-separated string; text() turns anything else into nothing.
const tags = (...values) => values.flatMap((value) => (Array.isArray(value) ? value : text(value).split(','))).map(text).filter(Boolean);

const siteName = (html, url) =>
  text(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1]) || new URL(url).hostname.replace(/^www\./, '');

// Page in, the input shape recipeFrom accepts out. No slug, no validation, no saving — recipes.js
// owns all three, and nothing here is stored until the writer presses Save in the form.
const extract = (html, url) => {
  const node = recipeNode(html);
  if (!node) return null;
  return {
    title: text(node.name),
    description: text(node.description),
    tags: tags(node.recipeCategory, node.recipeCuisine),
    servings: text(first(node.recipeYield)),
    prepTime: duration(node.prepTime),
    cookTime: duration(node.cookTime),
    image: image(node.image, url),
    ingredients: lines(node.recipeIngredient ?? node.ingredients),
    steps: lines(node.recipeInstructions),
    source: { url, name: siteName(html, url) },
  };
};

export const onRequestPost = async (context) => {
  const denied = await requireAuth(context); // Belt and braces: _middleware.js checks this too.
  if (denied) return denied;

  const { url } = (await context.request.json().catch(() => ({}))) ?? {};
  if (!/^https?:\/\//i.test(String(url ?? '')))
    return Response.json({ error: 'Paste a recipe link starting with http:// or https://' }, { status: 400 });

  // ponytail: redirect:'follow' is the default, so a shortened link already lands on the real page
  // and response.url is where it landed. Ticket 07 resolves Pinterest pins ahead of this fetch.
  const response = await fetch(url, { headers: BROWSER }).catch(() => null);
  if (!response?.ok) return Response.json({ error: 'That page could not be fetched. Check the link, or paste the recipe in by hand below.' }, { status: 502 });
  // Untrusted endpoint: only parse what claims to be HTML, so a PDF or a video is refused cheaply
  // rather than read into memory and run through the script regex.
  if (!/html/i.test(response.headers.get('content-type') ?? '')) return Response.json({ error: BY_HAND }, { status: 422 });

  const recipe = extract(await response.text(), response.url || url);
  if (!recipe?.ingredients.length && !recipe?.steps.length) return Response.json({ error: BY_HAND }, { status: 422 });

  return Response.json(recipeFrom(recipe));
};
