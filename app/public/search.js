// Client-side filtering over the single array already fetched for the list view. No search
// library: at 16 recipes (~8 KB gzipped) any library is larger than the data it searches.
// ponytail: substring scan, O(recipes x text). Holds to ~1,000 recipes — what breaks first is
// the download, not the scan. Upgrade path is paging or server-side filtering, not an index.

// Lowercase and strip accents, so "jalapeno" matches "jalapeño" and "saute" matches "sauté".
const fold = (text) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export const filterRecipes = (recipes, query = '', activeTag = '') => {
  const q = fold(query.trim());
  return recipes.filter(
    (recipe) =>
      (!activeTag || (recipe.tags || []).includes(activeTag)) &&
      (!q || fold([recipe.title, ...(recipe.ingredients || []), ...(recipe.tags || [])].join('\n')).includes(q)),
  );
};
