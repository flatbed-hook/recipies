// The page's filtering is a pure function, so it is tested directly against the real 16
// recipes — no DOM, no browser automation. The DOM wiring in index.html stays thin enough
// to read by eye.
import { env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { onRequestGet } from '../functions/api/recipes.js';
import { filterRecipes } from '../public/search.js';
import schema from '../schema.sql?raw';
import seed from '../seed.sql?raw';

let recipes;
const titles = (query, tag) => filterRecipes(recipes, query, tag).map((r) => r.title);

beforeAll(async () => {
  await env.DB.exec(schema.trim());
  await env.DB.exec(seed.trim());
  recipes = await (await onRequestGet({ request: new Request('http://test/api/recipes'), env })).json();
  expect(recipes).toHaveLength(16);
});

it('returns everything when nothing is searched or filtered', () => {
  expect(filterRecipes(recipes, '', '')).toHaveLength(16);
  expect(filterRecipes(recipes)).toHaveLength(16);
  expect(filterRecipes(recipes, '   ')).toHaveLength(16);
});

it('matches titles, case-insensitively and part-way through', () => {
  // "tab" also hits "tablespoon" in another recipe's ingredients — that is the ingredient
  // rule working, not a title bug.
  expect(titles('tabbou')).toEqual(['Tabbouleh']);
  expect(titles('TABBOULEH')).toEqual(['Tabbouleh']);
  expect(titles('tab')).toContain('Tabbouleh');
});

it('matches ingredients', () => {
  expect(titles('bulgur')).toEqual(['Tabbouleh']);
});

it('matches tags', () => {
  expect(titles('salads').sort()).toEqual(['Fresh Green Salad', 'Tabbouleh']);
});

it('strips diacritics both ways', () => {
  // "sauté" really appears in the migrated steps; the ingredient/tag/title text has no accent
  // to lean on, so this proves the folding rather than a lucky plain-text hit.
  expect(filterRecipes([{ title: 'Jalapeño Poppers' }], 'jalapeno')).toHaveLength(1);
  expect(filterRecipes([{ title: 'Jalapeno Poppers' }], 'jalapeño')).toHaveLength(1);
  expect(filterRecipes([{ title: 'Sauté', ingredients: [], tags: [] }], 'saute')).toHaveLength(1);
});

it('filters by a clicked tag', () => {
  expect(titles('', 'Soups').length).toBeGreaterThan(0);
  expect(titles('', 'Soups').every((t) => t)).toBe(true);
  for (const r of filterRecipes(recipes, '', 'Soups')) expect(r.tags).toContain('Soups');
});

it('combines a tag filter with a search', () => {
  expect(titles('chicken', 'Soups')).toEqual(['Chicken Soup + Stock']);
  expect(titles('chicken', 'Baking')).toEqual([]);
});

it('returns an empty array when nothing matches, so the page can show an empty state', () => {
  expect(filterRecipes(recipes, 'zzzznope')).toEqual([]);
});

it('survives the real punctuation in the data', () => {
  expect(titles('&')).toEqual(['Lemon-Garlic Chicken Pitas with Feta Tzatziki & Roasted Bell Peppers']);
  expect(titles('¼').length).toBeGreaterThan(0);
});
