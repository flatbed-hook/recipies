# Spec — Recipe site on Cloudflare Pages

Status: ready-for-agent (written 2026-10-20; no issue tracker configured, so this file is the spec of record)
Background research: `docs/recipe-site-rebuild-research.md`

---

## Problem Statement

I keep recipes at `recipies.citrons.me`. Today, saving a recipe means opening Claude Code, running a
slash command, and letting it write an HTML file and `git push`. That means:

- I cannot add a recipe without a laptop and a dev tool. My family cannot add one at all.
- Every recipe is hand-written HTML, so I cannot fix a typo, adjust a quantity, or add my own note
  without editing markup and committing.
- Each recipe has exactly one category, baked into both the page and the index. I cannot tag a dish
  as both "Salads" and "Make-ahead", and retagging means editing files.
- With 16 recipes I already scroll to find things. There is no search and no filter.

The underlying cause is that my recipes are stored as presentation (HTML pages) rather than as data.
Every limitation above follows from that one fact.

## Solution

A small web app at the same address where I paste a recipe URL, it extracts the recipe, and it saves
immediately — no git, no tooling, no wait. Recipes become structured data I can edit in the browser,
tag freely, and search by title or ingredient.

My wife and a few family members can add and edit too, behind a single shared password. Anyone can
read the site without logging in.

It is hosted on Cloudflare Pages as one git-connected project: the static front end and the API deploy
together on `git push`. Recipes live in a Cloudflare D1 database, so a save is visible on the next page
load rather than minutes later. The site keeps the address `recipies.citrons.me`, and DNS stays at
Namecheap so my Zoho email is never touched.

Where a site publishes no machine-readable recipe markup — Instagram, bare Pinterest pins, some blogs
— extraction fails with a clear message and I paste the recipe in by hand. That is accepted, not a bug.

## User Stories

### Reading

1. As a visitor, I want to see all recipes on one page, so that I can browse what is available without clicking through.
2. As a visitor, I want to open a recipe and see ingredients and steps clearly, so that I can cook from it.
3. As a visitor, I want the recipe page to show only the recipe, so that I am not scrolling past a life story and ads — this is the entire point of the site.
4. As a visitor, I want to read every recipe without logging in, so that I can send a link to someone and have it just work.
5. As a visitor on a phone, I want the page to be readable while I am cooking, so that I do not have to pinch and zoom with wet hands.
6. As a visitor, I want to see where a recipe came from and follow the link, so that I can credit the original and check the source if something looks wrong.
7. As a visitor, I want an old bookmarked recipe URL to still work after the rebuild, so that links I have shared do not break.

### Searching and filtering

8. As a visitor, I want to type into a search box and see the list narrow as I type, so that I can find a recipe without scrolling.
9. As a visitor, I want search to match recipe titles, so that I can find "Tabbouleh" by typing "tab".
10. As a visitor, I want search to match ingredients, so that I can type "bulgur" and find every recipe that uses it.
11. As a visitor, I want search to match tags, so that typing "baking" shows me everything I tagged that way.
12. As a visitor, I want search to ignore accents, so that typing "jalapeno" finds "jalapeño".
13. As a visitor, I want to click a tag and see only recipes carrying it, so that I can narrow to "Soups" without typing.
14. As a visitor, I want to clear a search or filter in one action, so that I can get back to the full list quickly.
15. As a visitor, I want to be told when a search matches nothing, so that I do not think the page is broken.

### Adding a recipe

16. As a writer, I want to paste a recipe URL and have the recipe extracted automatically, so that I do not retype it.
17. As a writer, I want to paste a shortened or redirecting link and have it followed to the real page, so that links copied from my phone work.
18. As a writer, I want `pin.it` and Pinterest links resolved to the underlying source site where possible, so that pins I have saved are usable.
19. As a writer, I want to review and correct the extracted recipe before it is saved, so that a bad parse never silently becomes a stored recipe.
20. As a writer, I want a clear message when a page has no machine-readable recipe, so that I know to paste it by hand rather than wondering why it failed.
21. As a writer, I want to create a recipe by typing or pasting it in directly, so that family recipes and un-extractable pages still get in.
22. As a writer, I want to assign tags while adding, so that the recipe is findable immediately.
23. As a writer, I want the source URL and site name stored automatically, so that attribution is never forgotten.
24. As a writer, I want to be warned if a recipe with the same name already exists, so that I do not create a duplicate.
25. As a writer, I want the recipe to appear on the site immediately after saving, so that I can confirm it worked while I am still looking at it.
26. As a writer, I want extraction failures to leave nothing behind, so that a failed attempt does not create a half-saved recipe.

### Editing

27. As a writer, I want to edit a recipe's title, description, ingredients, steps, and notes in the browser, so that I can fix mistakes without a laptop.
28. As a writer, I want to add my own notes to a recipe, so that I can record what I changed when I made it.
29. As a writer, I want to adjust ingredient quantities and have them stay changed, so that the stored recipe matches how I actually cook it.
30. As a writer, I want to add, remove, and reorder tags on an existing recipe, so that my categories can evolve.
31. As a writer, I want to reorder ingredients and steps, so that I can fix an out-of-order extraction.
32. As a writer, I want to delete a recipe, so that mistakes and duplicates do not accumulate.
33. As a writer, I want to be asked to confirm before a delete, so that I do not lose a recipe to a stray tap.
34. As a writer, I want my edit to be rejected rather than silently applied if someone else changed the recipe since I opened it, so that two people editing do not overwrite each other.

### Access

35. As a writer, I want to enter one shared password to unlock adding and editing, so that there are no accounts to manage.
36. As a writer, I want to stay logged in between visits, so that I am not re-entering the password every time.
37. As a writer, I want to log out, so that I can hand my phone to someone without giving them edit rights.
38. As the owner, I want visitors who are not logged in to see no edit controls at all, so that the public view stays clean.
39. As the owner, I want write attempts without a valid token rejected by the server, so that hiding the buttons is not the only thing protecting my data.
40. As the owner, I want to change the shared password without redeploying the front end, so that rotating it is cheap.

### Operations and migration

41. As the owner, I want all 16 existing recipes present and correct in the new site before I switch the domain over, so that nothing is lost.
42. As the owner, I want each existing recipe's single category carried over as its first tag, so that I start with the organisation I already have.
43. As the owner, I want to click through every migrated recipe on a preview URL before cutover, so that I catch migration errors myself.
44. As the owner, I want the current GitHub Pages site to stay live and untouched until the new one works, so that I always have a rollback.
45. As the owner, I want to download all recipes as a single JSON file, so that I have a backup that does not depend on Cloudflare.
46. As the owner, I want my Zoho email on `citrons.me` to be completely unaffected, so that a recipe project cannot cost me my mail.
47. As the owner, I want the whole site to deploy from one `git push`, so that I do not have to remember a second deploy step.

## Implementation Decisions

### Hosting and deployment

- **One Cloudflare Pages project, git-connected to the existing repository.** Static front end and API
  deploy together on push. This replaces GitHub Pages as the host.
- **Reuse the existing repository** rather than starting a new one. Its git history is a free backup of
  every recipe, and a new repo buys nothing.
- **API is implemented as Pages Functions**, not a separate Worker. A standalone Worker would require a
  second deploy step; Pages Functions ship in the same push.
- **Cloudflare Pages, not Cloudflare Workers Static Assets.** Cloudflare's own migration guide lists
  "custom domains outside Cloudflare zones" as a Pages capability that Workers lacks. Workers custom
  domains require the zone on Cloudflare nameservers, which would mean moving `citrons.me` off Namecheap
  and dragging Zoho MX, SPF, and DKIM records along with it. That risk is unacceptable for a recipe site.

### Domain and cutover

- **DNS stays at Namecheap.** The only change is the existing `recipies.citrons.me` CNAME, repointed
  from the GitHub Pages target to the Pages project target. Nameservers are not moved. No MX, SPF, or
  DKIM record is touched.
- **The custom domain must be added through the Cloudflare Pages dashboard**, not by creating the CNAME
  alone — a manually added record without dashboard setup resolves to an error.
- **Build and verify entirely on the project's preview URL first.** The domain is repointed only once
  the new site is confirmed working, which confines downtime to DNS propagation plus certificate issuance.
- **Certificate issuance for an externally-hosted custom domain is to be confirmed during setup**, not
  discovered at cutover. Cloudflare's docs describe the CNAME flow but do not explicitly document cert
  issuance for the external-DNS case.
- **Old recipe URLs are redirected**, so previously shared links resolve to the corresponding recipe in
  the new app.
- **The repository's existing `CNAME` file and the old recipe HTML files are not deleted** until the new
  site is live and verified. They are the rollback.

### Storage

- **Cloudflare D1, one table, one row per recipe**, holding the recipe as a JSON string:

  ```sql
  CREATE TABLE recipes (slug TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT)
  ```

- **No tags table.** Tags live in the JSON array and filtering happens in the browser. SQLite's
  `json_each()` plus an index can add server-side tag queries later; that change is purely additive, so
  this decision cannot be got wrong.
- **D1 rather than Workers KV.** KV is eventually consistent and read-modify-write on a single key
  holding the whole collection races between concurrent writers. D1 is strongly consistent for a few
  extra lines.
- **D1's free tier hard-errors when exhausted rather than billing.** Unreachable at this scale
  (100,000 row writes/day), but it is a cliff rather than a slope, and worth knowing.
- **Backups are the responsibility of the JSON export**, not of D1. D1's free Time Travel retains 7 days.

### Data model

Recipe records are a trimmed, normalised schema.org Recipe. Storing close to the extracted shape means
the extract path is fetch, pick fields, insert — with no mapping layer to maintain. This shape was
produced and validated by parsing all 16 existing files during research:

```json
{
  "slug": "tabbouleh",
  "title": "Tabbouleh",
  "description": "...",
  "tags": ["Salads", "Vegetarian", "Make-ahead"],
  "servings": "4", "prepTime": "20 min", "cookTime": "",
  "image": "https://…",
  "ingredients": ["1 cup bulgur", "…"],
  "steps": ["Soak the bulgur…", "…"],
  "notes": "…",
  "source": {"url": "https://…", "name": "Love and Lemons"},
  "updatedAt": "2026-10-20T12:00:00Z"
}
```

Three things are normalised on the way in, because every site does them differently:

- `recipeInstructions` arrives as a string, an array of strings, an array of `HowToStep`, or nested
  `HowToSection`s. It is flattened to an array of strings.
- `prepTime` and `cookTime` arrive as ISO-8601 durations such as `PT1H30M`. They are stored as a
  human-readable display string.
- `image` can be a string, an object, or an array. It is flattened to a single URL string.

- **`slug` is the identifier**, derived from the title, and is stable: renaming a recipe does not change
  its slug, so links do not break.
- **Edits replace the whole object** via a single update endpoint. No per-field endpoints, no patch
  semantics. Tag changes, reordering, and text edits are all the same operation.
- **`updatedAt` is used for conflict detection.** An update carrying a stale timestamp is rejected
  rather than applied.

### Extraction

- **No parsing library is installed.** Every JavaScript candidate is abandoned (`web-auto-extractor`
  2017, `microdata-node` 2020), types-only (`schema-dts`), or depends on a headless browser. The actual
  work is `JSON.parse` of `script[type="application/ld+json"]` and selecting the `Recipe` node — on the
  order of ten lines, with no dependency and no supply chain.
- **JSON-LD is the primary path.** Coverage is real: Web Data Commons' October 2024 crawl found
  `schema.org/Recipe` on 37,304 hosts, and Google's structured-data requirements push recipe sites to
  publish it.
- **Microdata is a secondary path** only if JSON-LD is absent, and only if it proves necessary in
  practice. It is not built speculatively.
- **No LLM, no API key, no per-recipe cost.** A page without machine-readable markup fails with a clear
  message and the user pastes the recipe in manually. This is a deliberate accepted limitation.
- **Extraction runs server-side** in a Pages Function, because a browser cannot fetch arbitrary
  third-party origins under CORS. Requests send a normal browser User-Agent, since some sites reject
  default agents.
- **Redirects are followed server-side** to resolve shortened links to their final URL.
- **Pinterest support is best-effort, not a feature.** Pinterest's `robots.txt` disallows all user
  agents, and the technique of scraping the embedded `"link"` JSON out of the pin page is inherently
  fragile. It is implemented, it is expected to break, and its failure path is the ordinary
  paste-by-hand message.

### API

- A read endpoint returns all recipes as a single JSON array. This serves both the list view and
  client-side search.
- A single-recipe read endpoint serves the recipe page.
- An extract endpoint accepts a URL and returns a parsed, normalised recipe for review. **It does not
  save.** Saving is a separate, explicit action, so a bad parse is never silently stored.
- Create, update, and delete endpoints require authentication.
- A login endpoint exchanges the shared password for a token.
- All write endpoints verify the token server-side. Hiding UI controls is a convenience, not the
  security boundary.

### Authentication

- **A single shared password**, stored as a Cloudflare secret and compared inside the Function. Changing
  it does not require a front-end redeploy.
- **The comparison is length-independent**, to avoid leaking information through timing.
- The client holds an opaque token in `localStorage` and sends it in an `Authorization` header.
- **A header, not a cookie**, because a cookie between the site's origin and the API would be
  third-party in some configurations and is blocked outright by Safari.
- Accepted trade-offs: no per-user attribution, and revocation means rotating the one password for
  everyone. With five trusted family members, a public recipe list, and a JSON backup, the blast radius
  of a leak is someone editing a recipe.
- **Upgrade trigger, recorded but not built:** the first time attribution or cutting off one individual
  matters, move to Cloudflare Access, which is free up to 50 users and works on this hostname.

### Front end

- **Vanilla JavaScript. No framework, no build step, no bundler.** The application is a list view, a
  recipe view, and an edit form.
- `styles.css` is carried over, extended as needed. The existing visual design is kept.
- **Search and tag filtering are client-side** `Array.prototype.filter()` over the single fetched array.
  No search library: at this scale any library is larger than the data itself.
- Search is case-insensitive and strips diacritics so "jalapeno" matches "jalapeño".
- **This holds to roughly 1,000 recipes.** The measured size is about 1.4 KB of JSON per recipe — 16
  recipes are 22.8 KB raw and 8.3 KB gzipped, and 200 recipes are about 103 KB gzipped. What breaks
  first is the download, not the filtering. The fix at that point is paging or server-side filtering in
  the Function, not a client-side search library.

### Migration

- **A one-off script, run once, then discarded.** It is not application code and is not maintained.
- **Regex per section is sufficient** — no cheerio, no parsing library. The 16 files share one rigid
  template. This was validated during research: all 16 parsed with zero missing titles, ingredient
  lists, or step lists.
- Each file's existing single category becomes the first element of its `tags` array. Existing values
  are `Baking`, `Other`, `Salads`, `Soups`, `Vegetarian`.
- Output is seeded into D1 in one load.
- Migration output is reviewed by hand against the live old site before cutover.

## Testing Decisions

### What makes a good test here

Tests assert on **external behavior through the HTTP API**: a `Request` goes in, a `Response` comes
out, and assertions are made on status and body. They do not reach into internal functions, assert on
how extraction is implemented, or check that a particular helper was called. If the extractor is
rewritten and the same URL still yields the same recipe JSON, the tests must not notice.

### The seam

**One seam: the HTTP API.** Tests invoke the Pages Functions handler directly against a real local D1
instance, which the Cloudflare Workers test tooling provides. `fetch` is stubbed for extraction tests so
the suite never depends on a live third-party recipe site being up or unchanged.

One seam covers routing, authentication, storage, and extraction together. The extractor is deliberately
**not** given its own seam — stubbing `fetch` reaches it through the API, and a second seam would add a
test surface without adding coverage.

### What is tested

- **Extraction**: a stubbed page with valid JSON-LD yields correctly normalised recipe JSON. Each of the
  three normalisation cases is covered: instructions in every shape they arrive in, ISO-8601 durations,
  and image as string, object, and array.
- **Extraction failure**: a stubbed page with no recipe markup returns a clear error and saves nothing.
- **Redirects**: a stubbed redirect chain resolves to the final URL before parsing.
- **Authentication**: every write endpoint rejects a missing token, a wrong token, and an expired or
  malformed one; the login endpoint rejects a wrong password and accepts the right one.
- **CRUD**: create then read returns what was written; update replaces the whole object including tag
  changes; delete removes it; reading a nonexistent slug returns not-found.
- **Conflict detection**: an update carrying a stale `updatedAt` is rejected rather than applied.
- **Duplicate slugs**: creating a recipe whose title collides with an existing one is reported, not
  silently overwritten.

### Prior art

**There is none** — the repository currently contains no tests, no build step, and no package manifest.
This spec introduces the first test setup. Because there is no existing convention to match, the suite
should stay minimal: the Workers test tooling, one test file against the API seam, no fixtures framework
beyond saved HTML strings for the stubbed pages.

## Out of Scope

- **Mobile share-sheet or share-target integration.** Explicitly not wanted. Adding is by pasting a URL.
- **LLM-based extraction of any kind**, including for pages that lack markup and including screenshots
  and images. No API key, no per-recipe cost.
- **Per-user accounts, user attribution, an edit history, or per-user permissions.** One shared password.
- **Reliable Pinterest and Instagram support.** Best-effort only; failure falls back to manual paste.
- **Image hosting and upload.** Images are referenced by their source URL. The site does not store them.
- **Any client-side search library**, and any server-side search index. Plain filtering until roughly
  1,000 recipes.
- **A tags table or any normalised relational schema.** One JSON column.
- **Recipe scaling, unit conversion, meal planning, shopping lists, and print layouts.** None of these
  were asked for.
- **A framework or build step for the front end.**
- **Moving `citrons.me` nameservers to Cloudflare.** Specifically excluded to protect Zoho email.
- **Deleting the old GitHub Pages files**, until after a verified cutover.

## Further Notes

- **The domain is the risky part of this project, not the code.** `citrons.me` carries Zoho email: MX
  records, an SPF record, and a Zoho verification TXT record. Everything in this spec is arranged so
  that the only DNS change is one CNAME on one subdomain.
- **Order of work**, so that the live site is never at risk: D1 and migration first, then a read-only
  site on the preview URL, then authentication and writing, then editing, then search, and the domain
  cutover last.
- **A Cloudflare account becomes a thing that must not be lost.** The JSON export exists for this reason,
  and the old repository remains a second copy of the original 16 recipes.
- **Cloudflare's free Workers tier is a product, not a contract.** It is 100,000 requests/day today.
- **This spec deliberately skips a smaller alternative** that was considered and rejected: keeping the
  static site and having a single endpoint commit extracted recipes back to the repository. It solves
  adding, but leaves editing, tags, and search unsolved, and carries a publish delay of up to ten
  minutes visible on every save. About 60% of its code carries over to this build anyway, so skipping it
  discards almost nothing.
