// One-off migration: recipes/*.html -> seed.sql. Run once, then discard.
//   npm run migrate      regenerate seed.sql
//   npm run db:init      load schema + seed into LOCAL D1
//   npm run db:init:remote   load schema + seed into REMOTE D1 (owner runs this once)
// The 16 files share one rigid template (verified: no entities, no images, no nested markup),
// so regex per section is enough. Not application code, not maintained.
import { readFileSync, readdirSync } from 'node:fs';

const UPDATED_AT = '2026-10-20T12:00:00Z';
const DIR = new URL('../recipes/', import.meta.url);

const text = (s) => s.replace(/<[^>]+>/g, '').trim();
const one = (html, re) => (html.match(re)?.[1] ?? '').trim();
const items = (html, re) => [...one(html, re).matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => text(m[1]));

const recipes = readdirSync(DIR)
  .filter((f) => f.endsWith('.html'))
  .sort()
  .map((file) => {
    const html = readFileSync(new URL(file, DIR), 'utf8');
    const meta = Object.fromEntries(
      [...one(html, /<ul class="meta">([\s\S]*?)<\/ul>/).matchAll(/<li><strong>(.*?):<\/strong>([\s\S]*?)<\/li>/g)]
        .map((m) => [m[1].trim(), text(m[2])]),
    );
    const footer = one(html, /<footer class="source">Source:([\s\S]*?)<\/footer>/);
    const link = footer.match(/<a href="([^"]+)">([\s\S]*?)<\/a>/);

    return {
      slug: file.replace(/\.html$/, ''),
      title: text(one(html, /<h1>([\s\S]*?)<\/h1>/)),
      description: text(one(html, /<p class="description">([\s\S]*?)<\/p>/)),
      tags: [meta.Category],
      servings: meta.Servings ?? '',
      prepTime: meta['Prep time'] ?? '',
      cookTime: meta['Cook time'] ?? '',
      image: '', // no <img> in any of the 16 files
      ingredients: items(html, /<ul class="ingredients">([\s\S]*?)<\/ul>/),
      steps: items(html, /<ol class="steps">([\s\S]*?)<\/ol>/),
      notes: text(one(html, /<h2>Notes<\/h2>\s*<p>([\s\S]*?)<\/p>/)),
      source: link ? { url: link[1], name: text(link[2]) } : { url: '', name: text(footer) },
      updatedAt: UPDATED_AT,
    };
  });

for (const r of recipes) {
  if (!r.title || !r.tags[0] || !r.ingredients.length || !r.steps.length) throw new Error(`incomplete: ${r.slug}`);
}

const q = (s) => `'${s.replace(/'/g, "''")}'`;
// No comment header: D1's `exec` rejects any line that is not a statement.
process.stdout.write(
  recipes
    .map((r) => `INSERT OR REPLACE INTO recipes (slug, json, updated_at) VALUES (${q(r.slug)}, ${q(JSON.stringify(r))}, ${q(r.updatedAt)});`)
    .join('\n') + '\n',
);
