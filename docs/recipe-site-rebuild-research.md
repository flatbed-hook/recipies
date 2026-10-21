# Recipe site rebuild — research

Researched 2026-10-20. Every factual claim below is cited to a primary source in the Sources list.
Anything I could not confirm from a first-party page is marked **UNVERIFIED**.

---

## Recommendation

**Keep `recipies.citrons.me` on GitHub Pages exactly where it is. Add one Cloudflare Worker on
`*.workers.dev` holding the extractor + a D1 database, and turn `index.html` into a small vanilla-JS
app that talks to it. Auth is one shared password checked inside the Worker.**

One sentence why: it is the only option that adds **zero DNS work, zero TLS work and zero downtime**
(the hostname never moves), costs $0 at this volume, and still gives instant writes — static asset
serving stays on Pages, which never needs rebuilding again, and every recipe read/write is a single
Worker call against D1.

Honest main drawback: **two deploy targets.** The front end still ships by `git push` (GitHub Pages),
the Worker ships by `wrangler deploy`. If that annoys you more than a DNS migration does, collapse it
to one target by moving `citrons.me` nameservers to Cloudflare and serving the static files from the
Worker itself (Workers Static Assets) — same code, one deploy, but you pay for it with a nameserver
move and a cert re-issue window. Today `citrons.me` is on Namecheap nameservers
(`dns1.registrar-servers.com`), so that move is real work, not a checkbox.

Second drawback worth naming: D1's free tier **hard-errors** when exceeded rather than billing you.
At ~5 writers that is unreachable (100,000 row writes/day), but it is a cliff, not a slope.

Stack, concretely:

| Piece | Choice | Why |
| --- | --- | --- |
| Host (static) | GitHub Pages, unchanged | CNAME + cert already working; nothing to migrate |
| API + extraction | 1 Cloudflare Worker, `*.workers.dev` | free static-asset/CPU budget, `fetch` + `HTMLRewriter` built in |
| Parser | `JSON.parse` of `script[type="application/ld+json"]` | no dependency at all (see Q1) |
| Storage | Cloudflare D1, one table | strongly consistent, 5 GB free, SQL when you need tags |
| Auth | shared password → token in `localStorage` → `Authorization` header | ~15 lines, no accounts, no IdP |
| Search | `Array.prototype.filter()` over one fetched JSON array | 16 recipes = 22.8 KB; 200 ≈ 285 KB |

Speculative / you-will-maintain-this flags:
- A Cloudflare account is one more account to not lose. D1 free backup is **Time Travel, 7 days**, so keep the nightly JSON dump (one `wrangler d1 execute` in a cron, or just press a "Download JSON" button occasionally).
- `pin.it` resolution is inherently fragile (see Q1.3) and Pinterest's `robots.txt` disallows `User-agent: *` on everything. Treat Pinterest support as best-effort, not a feature.
- Cloudflare's free Workers tier is generous but is a product, not a contract. 100,000 requests/day today.

---

## Q1 — Extraction without an LLM

### 1.1 How widely is schema.org/Recipe published?

There is real measured data, not just vendor guidance. Web Data Commons extracts structured data from
the Common Crawl; in the **October 2024 crawl** the `schema.org/Recipe` class-specific subset contains
**258,349,284 quads across 37,304 hosts**, out of 16.5 million domains (of 37.4 million crawled) that
publish any structured data at all. Recipe markup is therefore not universal across the web, but it is
heavily concentrated in exactly the sites you paste: food blogs run WordPress recipe plugins (WP Recipe
Maker, Tasty Recipes) that emit schema.org/Recipe JSON-LD by default, because that is what gets them a
Google rich result.

Google's own Recipe structured-data doc confirms the incentive and the shape: it documents JSON-LD
examples throughout and requires only `image` and `name`, with `recipeIngredient`,
`recipeInstructions`, `prepTime`, `cookTime`, `recipeYield` as the standard recommended set. Any site
that wants the recipe rich result must publish this. Google does not publish a coverage percentage.

**Practical read:** expect high success on mainstream food blogs and recipe sites, near-zero on
Instagram/Pinterest/newspaper paywalls/PDF scans. The user's stated fallback (paste by hand) is the
correct design, and it is also what `recipe-scrapers` itself does — it falls back from schema markup to
OpenGraph metadata and still fails on some sites.

I could not find a published "% of recipe pages with valid JSON-LD" study from a primary source.
**UNVERIFIED** — treat any blog claiming "90%+" as unsourced.

### 1.2 Libraries

| Library | Latest | Released | License | Size | Deps | Runs on Workers/edge? |
| --- | --- | --- | --- | --- | --- | --- |
| **hhursev/recipe-scrapers** (Python) | 15.13.0 | **2026-10-18** (2 days ago) | MIT | 359 KB wheel | `beautifulsoup4`, `extruct`, `isodate` | Not on the JS runtime. Python Workers are GA and support pure-Python + PyEmscripten wheels, so it *might* bundle — `beautifulsoup4` is pure Python but `extruct` pulls `lxml`. **UNVERIFIED**, would need a real `pywrangler deploy` to find out. |
| `web-auto-extractor` (JS) | 1.0.17 | **2017-09-21** | MIT | — | `babel-polyfill`, `cheerio`, `htmlparser2` | Abandoned 9 years. Do not use. |
| `microdata-node` (JS) | 2.0.0 | **2020-05-11** | MIT | 36.8 KB | `domutils`, `htmlparser2`, `is-absolute-url` | Unmaintained 6 years; microdata only, no JSON-LD. |
| `@cucumber/microdata` (JS) | 2.2.0 | 2025-05-01 | MIT | 135 KB | none | Maintained, zero deps — but needs a **DOM**, and microdata is the minority format. |
| `schema-dts` | 2.1.0 | 2026-10-02 | Apache-2.0 | 1.0 MB | — | **Types only.** Zero runtime behaviour. Useful for TS autocomplete, nothing else. |
| `cheerio` | 1.2.0 | 2026-01-23 | MIT | 1.0 MB | 11 deps incl. `undici`, `parse5` | Would probably work (see note below) but it is 1 MB to do `JSON.parse`. |
| `recipe-scraper` (JS) | 2.1.1 | 2021-05-21 | MIT | 83.9 KB | **`puppeteer`** | Dead, and depends on headless Chrome. Disqualified. |

**Surprise worth flagging:** the brief's premise that "Cloudflare Workers has no Node `fs`/`net`" is
**out of date**. Cloudflare's current Node.js compatibility matrix lists both `node:fs` and `node:net`
as 🟢 supported under `nodejs_compat`. So cheerio-class libraries are no longer automatically excluded.

**But you still should not install any of them.** The actual job is:

```js
const html = await (await fetch(url, {headers:{'user-agent': UA}})).text();
const blocks = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
const recipe = blocks.flatMap(m => { try { return [JSON.parse(m[1])].flat(); } catch { return []; } })
  .flatMap(o => o['@graph'] ?? o)
  .find(o => [].concat(o['@type'] ?? []).includes('Recipe'));
```

That is the whole JSON-LD extractor. It handles the three real-world wrinkles (array at top level,
`@graph` wrapper, `@type` as array). If you want to parse rather than regex the HTML, Workers ships
**HTMLRewriter** natively — no dependency, streaming, part of the runtime. Microdata/RDFa fallback is
not worth writing: it is a small minority of sites and those sites will be hand-entered anyway.

Verdict: **no extraction library.** `recipe-scrapers` is excellent and genuinely maintained, but it is
a Python runtime plus 742 site-specific scrapers to solve a problem that is 8 lines on the 80% of sites
that matter. Revisit only if real-world hit rate disappoints — at which point a tiny scheduled
GitHub Action running `recipe-scrapers` and POSTing to the Worker is the upgrade path, not a rewrite.

### 1.3 Short links / Pinterest

What the current slash command does (`.claude/commands/add-recipe.md`): `curl -s -L` with a desktop
Chrome User-Agent to get `%{url_effective}`, then `curl` the resolved `pinterest.com/pin/<id>/` page
and `grep -o '"link":"[^"]*"'` out of the embedded JSON.

Assessment: **the redirect half is right and should move into the Worker as-is**; the Pinterest-scrape
half is right in approach but will keep breaking.

- Redirect resolution is free in a Worker: `fetch()` implements the standard Fetch API, so following
  3xx is the default behaviour and the final URL is `response.url`. No API key, no library. Pass a
  browser-like `User-Agent` — the Workers runtime lets you set request headers freely.
- Pinterest specifically: `https://www.pinterest.com/robots.txt` currently serves `User-agent: *` →
  `Disallow: /`. Scraping pin pages is against their stated robots policy and they run bot detection
  on datacenter IPs. The `"link":"..."` JSON grep works until they rename the field or gate the page.
  Keep it, wrap it in try/catch, and when it fails tell the user to paste the real URL.
- Cheaper trick first: many pins expose the destination in `og:url` / `<link rel="canonical">`, and
  some short links (`bit.ly`, `t.co`, `smarturl`) resolve to the destination directly with no scraping
  at all. Resolve-and-check-the-host first; only scrape Pinterest if the final host is Pinterest.

### 1.4 CORS / the proxy layer

A browser genuinely cannot fetch an arbitrary recipe site (no `Access-Control-Allow-Origin`), so a
server-side fetch hop is mandatory. Comparing the four, for this one job:

| | Free tier (vendor-stated) | Verdict for this job |
| --- | --- | --- |
| **Cloudflare Workers** | 100,000 requests/day; 10 ms **CPU** per invocation; 50 subrequests/request; 64 MiB script | **Winner.** The 10 ms is CPU time, not wall time — waiting on `fetch` does not count, so a slow recipe site does not blow the budget. Static assets are "free and unlimited". |
| **Vercel Functions (Hobby)** | 1,000,000 invocations, 100 GB fast data transfer, 300 s max duration | Fine technically. But Hobby is **"restricted to non-commercial personal use only"** (OK here) and sustained overage "can lead to a paused deployment". |
| **Deno Deploy** | 1M requests/month, 20 GiB egress, 1 GiB KV, 10 deployments | Perfectly adequate; smaller ecosystem, and overage behaviour is not documented on the pricing page. |
| **Val Town** | 100,000 runs/day, 1 min wall clock, 3-day logs, **0 custom domains on Free** | Best *authoring* experience (edit in browser, no deploy step). SQLite on free is small and custom domains are paid. Good for a prototype, not the home. |

**Reliability caveat, and it is the real one:** recipe sites increasingly sit behind Cloudflare
bot-management, Akamai, or DataDome, all of which treat datacenter IPs as suspect. Any serverless
proxy — Workers included — will get 403s from some sites that work fine from the user's laptop. You
must send a realistic `User-Agent` (an empty or `node-fetch` UA is an instant block on many sites), and
you must design the UI so a failed extract degrades to "paste it yourself" rather than an error page.
There is no $0 fix for this; residential proxies cost money. Expect a double-digit percentage of
"should have worked" failures, and accept it.

---

## Q2 — Storage + hosting

### (a) Serverless function → GitHub REST API commit → GitHub Pages

- **Limits:** Pages site ≤ 1 GB; repo recommended ≤ 1 GB; **soft** bandwidth 100 GB/month; **soft**
  10 builds/hour. GitHub REST API: 5,000 req/hour for a PAT or OAuth app, 5,000+ for a GitHub App
  installation; secondary limit **80 content-creating requests/minute and 500/hour**. Writes use
  `PUT /repos/{owner}/{repo}/contents/{path}` with base64 `content` and the prior blob `sha`;
  parallel calls to this endpoint conflict and must be serialised.
- **Setup effort:** low-ish — one function, one token.
- **Write latency: the killer.** GitHub's own doc: *"It can take up to 10 minutes for changes to your
  site to publish after you push the changes to GitHub."* Click Save → wait minutes → see recipe. For
  an edit-in-place UI that is unusable.
- **Over limit:** builds/bandwidth are *soft* — GitHub contacts you / may throttle rather than bill.
  API rate limits return 403/429.
- Also: the 10 builds/hour soft limit means a flurry of edits is actively bad behaviour.

### (b) Cloudflare Workers + D1 (+ Pages)

- **Limits (vendor-stated):** Workers free 100,000 req/day, 10 ms CPU/invocation. D1 free: **5 million
  rows read/day, 100,000 rows written/day, 5 GB total storage, 500 MB per database, 10 databases**,
  50 queries per Worker invocation, Time Travel 7 days. Pages free: 500 builds/month, 20,000 files,
  25 MiB max file. Worker static assets: requests to them are **"free and unlimited"**.
- **Setup effort:** one `wrangler.toml`, one `wrangler d1 create`, one `CREATE TABLE`. Low.
- **Write latency: milliseconds.** D1 is a real SQL database; the next `GET` sees the row. This is the
  whole reason it wins.
- **Over limit:** **hard stop, not a bill.** D1 "returns error messages indicating you have exhausted
  your daily allowance"; storage overage blocks inserts. Workers over 100k/day either bypass the Worker
  (fail-open) or return Cloudflare error 1027 (fail-closed), depending on route config.
- Alternative inside the same stack: **Workers KV** (free: 100,000 reads/day, **1,000 writes/day**,
  1 GB, 25 MiB value). One key holding the whole JSON array would work and is even simpler — but KV is
  eventually consistent and read-modify-write on one key races. D1 for a few more lines of code.

### (c) Supabase free

- **Limits:** 500 MB database, 5 GB egress, 50,000 MAU, **limit of 2 active projects per org**.
- **The disqualifier:** Supabase's own docs state *"We may pause applications on the Free Plan that
  exhibit low activity in a 7-day period to save on server resources"*, and the pricing page says
  projects pause after 1 week of inactivity. **This site is used a few times a month.** It would be
  paused essentially always, and every visit would start with the owner un-pausing it from a dashboard.
  Fatal for this specific use case. Everything else about Supabase (auth, row-level security, instant
  REST) would otherwise fit nicely.

### (d) Deno Deploy / Val Town

- Deno Deploy free: 1M requests/month, 20 GiB egress, 1 GiB KV storage, 10 GiB revision storage,
  10 deployments. Overage behaviour not stated on the pricing page — **UNVERIFIED**.
- Val Town free: 100,000 runs/day, 1 min wall clock per run, 2,500 vals, **0 custom domains**,
  15-min minimum cron. SQLite free-plan storage is small (community/docs put it at 10 MB;
  not stated on the primary limits page — **UNVERIFIED**).
- Neither goes to sleep in the Supabase sense. Both are credible; neither beats Workers on free limits
  or on "the static host I already have keeps working".

### (e) Anything materially better

**Cloudflare Workers Static Assets** — a single Worker that serves the whole site *and* the API, one
deploy, static requests unbilled. This is strictly nicer than (b) with Pages split off... except it
needs the hostname on a Cloudflare zone, i.e. moving `citrons.me` nameservers off Namecheap. That is
the one-time cost of collapsing to a single deploy target. If you ever move DNS to Cloudflare for any
other reason, switch to this immediately.

### Sleep / pause / deletion summary (the thing that matters for a site used monthly)

| Option | Behaviour when idle for weeks |
| --- | --- |
| GitHub Pages | Nothing. Static files, always served. |
| Cloudflare Workers + D1 | Nothing. No cold-pause, no idle deletion. |
| Workers KV | Nothing. |
| **Supabase free** | **Paused after ~7 days of inactivity.** Must be manually resumed. |
| Vercel Hobby | No idle pause; pauses are for overage/policy, not inactivity. |
| Deno Deploy / Val Town | No documented idle pause. **UNVERIFIED** for long-term dormancy. |

---

## Q3 — Auth for ~5 writers, $0

| Option | Cost / seats | Work | Real failure mode |
| --- | --- | --- | --- |
| **Shared password → token** | $0 | **~15 lines.** `POST /login` compares to a Worker secret, returns an opaque token; client stores it in `localStorage` and sends `Authorization: Bearer`. | No attribution (who broke the tabbouleh?), no revocation short of rotating the password for all 5. If it leaks, anyone can write — but worst case is vandalism of a recipe list with a full JSON backup. |
| **Cloudflare Access** | **Free up to 50 users** (Cloudflare's Access page: "$0 forever… 50 user limit"); $7/seat on Standard above that. Notably, Access *can* protect a Worker's `workers.dev` hostname and previews, not only custom domains. | Medium: enable Zero Trust on the account, create an Access application, add 5 emails, use the free one-time-PIN login. Then read `Cf-Access-Jwt-Assertion`. | Protecting the **whole Worker** also protects public reads — you would need a path-scoped policy or a second Worker for the public read endpoint. That is the complication that drops it below the shared password here. Also one more product to understand. |
| **Supabase magic link** | $0 within free tier | Low *if* you were already on Supabase | You are not, and Supabase pauses when idle (Q2c). Bringing in a whole BaaS for login is the tail wagging the dog. |
| **GitHub OAuth** | $0 | Highest. An **OAuth App** is enough (a GitHub App is only needed if you want fine-grained repo permissions / installation tokens). The client secret must live server-side — a Worker secret — and you must implement the code-exchange callback and a session cookie yourself. | Every writer needs a GitHub account; the callback URL is a fixed config you will break once; sessions are now your problem. Only worth it if the storage is the GitHub repo *and* you want per-user commits. |

**Pick: the shared password.** Five trusted family members, a public recipe list, $0, no new account,
no IdP, and the blast radius of a leak is "someone edits a recipe" against a JSON backup. Store it as a
Worker secret (`wrangler secret put EDIT_PASSWORD`), compare with a length-independent comparison, and
serve the token over HTTPS only. **Upgrade trigger:** the first time you want to know who changed
something, or you need to cut one person off — then move to Cloudflare Access, which is free at this
size and is already compatible with the `workers.dev` hostname.

(Why `localStorage` + `Authorization` header rather than a cookie: the front end on
`recipies.citrons.me` calls an API on `*.workers.dev`, which makes any cookie a third-party cookie —
Safari blocks those outright. A header avoids the entire problem and costs one `OPTIONS` handler.)

---

## Q4 — Data model

### Shape

Store **one JSON object per recipe, shaped like a trimmed schema.org Recipe, with your own fields
alongside it.** Yes, the extracted shape is the right base: the extractor already hands you
`name` / `recipeIngredient` / `recipeInstructions` / `prepTime` / `cookTime` / `recipeYield` / `image`,
so storing near-verbatim means the extract path is `fetch → pick fields → insert`, with no mapping
layer to write or maintain. But do **not** store raw schema.org — normalise three things on the way in,
because every site does them differently:

- `recipeInstructions` arrives as a string, an array of strings, an array of `HowToStep`, or
  `HowToSection`s. Flatten to `string[]`.
- `prepTime`/`cookTime` arrive as ISO-8601 durations (`PT1H30M`). Keep the raw value, store a
  human string for display. (This is exactly what `recipe-scrapers` uses `isodate` for.)
- `image` can be a string, an object, or an array. Flatten to one URL string.

Suggested record — flat, boring, no nesting beyond arrays:

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

In D1: `CREATE TABLE recipes (slug TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT)`. One column
of JSON. **Do not build a tags table.** Tags live in the JSON array; filtering happens in the browser.
If you ever need server-side tag queries, SQLite has `json_each()` and you add an index then — the
schema change is additive, so this is not a decision you can get wrong.

This shape makes the three required features cheap:
- **In-place edit** — the editor PUTs the whole object back. No per-field endpoints, no patch semantics.
- **Multi-tag + retag/reorder** — it is an array of strings in one object; reordering is array order.
- **Search** — see below.

### Payload size (measured, not guessed)

I parsed all 16 existing `recipes/*.html` into the model above with a 20-line regex script. Result:

- **22,783 bytes of JSON for 16 recipes → ~1,423 bytes per recipe**
- gzipped: **8,272 bytes** (and every host here gzips/brotlis by default)

Extrapolating at 1.4 KB/recipe:

| Recipes | Raw JSON | ~gzipped |
| --- | --- | --- |
| 50 | 71 KB | 26 KB |
| 200 | 285 KB | 103 KB |
| 500 | 712 KB | 258 KB |
| 1,000 | 1.4 MB | 517 KB |

### Search

**Plain `.filter()` over the single fetched array is correct and will stay correct far past your
horizon.** Lowercase the query, test `title` and `ingredients.join(' ')` and `tags`. On a phone,
filtering a few hundred objects is sub-millisecond; the fetch dominates.

It stops being enough at roughly **1,000–2,000 recipes**, and the thing that breaks first is the
*download*, not the filtering — about half a megabyte gzipped before it feels heavy on mobile data.
At that point the fix is paging/server-side filtering in the Worker (D1 + `LIKE`, or SQLite FTS5),
not a client-side search library. Do not install Fuse.js, Lunr, MiniSearch or anything else now: at
16–200 recipes the library is bigger than the data. The one thing worth adding before any library is
`String.normalize('NFD')`-stripped diacritics so "jalapeno" matches "jalapeño" — one line.

---

## Q5 — Migration

### The 16 HTML files

**A one-off script is enough, and it already works.** I ran a ~20-line Python regex parse against all
16 files as part of this research: 16/16 parsed, with **zero missing titles, zero missing ingredient
lists, zero missing step lists**. Existing categories found: `Baking`, `Other`, `Salads`, `Soups`,
`Vegetarian` — these become the initial `tags` array (one element each; add more by hand afterwards).

You do not need cheerio or BeautifulSoup. The template is rigid (`<h1>`, `p.description`, `ul.meta`
with `<strong>Label:</strong>`, `ul.ingredients`, `ol.steps`, `h2>Notes`, `footer.source`) and
regex-per-section is sufficient for a script that runs exactly once and whose output you will eyeball.
Pipe its JSON into `wrangler d1 execute --file=seed.sql` and the migration is done.

Keep `recipes/*.html` in the repo untouched until the new app is live and you have clicked through
every recipe. They cost nothing and they are your rollback.

### Keeping `recipies.citrons.me` up

Current state, verified by DNS lookup today:

- `citrons.me` nameservers: `dns1.registrar-servers.com` / `dns2.registrar-servers.com` (Namecheap).
- `recipies.citrons.me` → `CNAME flatbed-hook.github.io` → GitHub Pages IPs (185.199.108–111.153).
- `CNAME` file in the repo root contains `recipies.citrons.me`, which is what tells Pages to claim
  that hostname and request the certificate.
- TLS today is a **Let's Encrypt** certificate that GitHub requests automatically once its DNS check
  passes; it can take up to an hour after configuring the domain, and if you use CAA records at least
  one must allow `letsencrypt.org`.

What each Q2 option would require to take over the hostname:

| Option | DNS change | TLS | Downtime risk |
| --- | --- | --- | --- |
| **Recommended (Pages stays)** | **None.** The Worker lives on `*.workers.dev`, which has its own Cloudflare cert. | **None.** Existing cert untouched. | **Zero.** This is the entire argument. |
| Workers Static Assets on `recipies.citrons.me` | Move `citrons.me` NS to Cloudflare (full zone), then add a Custom Domain — Cloudflare requires an active zone you own and **will not** attach a Custom Domain to a hostname that already has a CNAME record, so the old GitHub CNAME must be deleted first. | Automatic and free; Cloudflare issues it (including an Advanced Certificate for multi-level subdomains at no extra cost). | Real but manageable: NS propagation plus the gap between deleting the GitHub CNAME and the Cloudflare cert going live. Do it at night; keep `flatbed-hook.github.io` as the fallback URL. |
| Vercel / Deno Deploy / Val Town | Repoint the CNAME at their host and remove the repo `CNAME` file. | Vercel and Deno issue certs automatically; **Val Town Free allows 0 custom domains**, so this hostname cannot move there at all on the free plan. | A short window where the name resolves to the new host before its cert is issued. |

In all cases: do **not** delete the repo `CNAME` file until the hostname is actually serving from
somewhere else, and keep the old `recipes/*.html` paths resolving (or 301 them) if anyone has
bookmarked a recipe.

---

## The lazy baseline to beat

**Smallest possible change: one Cloudflare Worker with a single `POST /add` endpoint that takes a URL,
extracts the JSON-LD, renders the exact existing HTML template, and commits both the new
`recipes/<slug>.html` and the edited `index.html` via `PUT /repos/flatbed-hook/recipies/contents/…`.
A plain `<form>` on the existing `index.html` posts to it with the shared password. Nothing else changes.**

Cost of the baseline: one Worker file, maybe 120 lines, one GitHub fine-grained PAT stored as a Worker
secret, no database, no data model, no migration, no DNS change. The site, the template, the CSS and
all 16 existing files are untouched. You could have this working in an evening.

The hosted-no-code variant (static site reads JSON from Airtable/Google Sheets/a Notion database) is
*not* better: it adds a third-party account, an API key that must be proxied anyway because of CORS,
and a data store you do not control — for the same amount of work as D1.

**What the baseline does NOT give you, measured against the stated requirements:**

| Requirement | Baseline |
| --- | --- |
| Paste a URL, no git in the loop | ✅ Solved. This is the whole pain and the baseline removes it. |
| Short-link / `pin.it` resolution | ✅ Same code either way. |
| Recipe visible immediately | ❌ **Up to 10 minutes** (GitHub Pages publish delay), plus the 10-builds/hour soft limit. |
| Edit a recipe in place from the browser | ❌ Not at all. You would be editing HTML through an API — doable, horrible. |
| Multiple tags, retag, reorder | ❌ The data lives in handwritten HTML. Retagging 50 recipes means 50 commits. |
| Search / filter by title or ingredient | ❌ Would need the HTML parsed in the browser, or a separate index file maintained in parallel — at which point you have built the data model badly. |

**Distance from baseline to the full build:** the baseline *is* about 60% of the full build's code —
the extractor, the auth check, and the front-end form are identical and carry over unchanged. What the
full build adds is: swap the GitHub-commit call for a D1 insert (~20 lines), the one-off migration
script (~20 lines, already written and tested above), an edit form (~60 lines of vanilla JS), and a
filter box (~10 lines). Call it **one extra evening**, and it is the evening that buys editing, tags
and search.

**Recommendation on the baseline: skip it.** Not because it is bad — it is a genuinely good shape —
but because three of the user's six stated requirements land in the "❌" column, the 10-minute publish
delay is user-visible on every single save, and the work you would throw away is small. The baseline
is the right answer only if "edit, tag, search" turn out to be aspirational and the real need is just
"stop making me run Claude Code to save a recipe."

---

## Sources

Primary sources, each read on 2026-10-20.

**Extraction / markup**
- Google Search Central, Recipe structured data — https://developers.google.com/search/docs/appearance/structured-data/recipe
- Web Data Commons, structured data stats (Oct 2024 crawl; 16.5M of 37.4M domains, 15.6B entities) — https://webdatacommons.org/structureddata/
- Web Data Commons, schema.org class subsets (schema.org/Recipe: 258,349,284 quads / 37,304 hosts) — https://webdatacommons.org/structureddata/2024-12/stats/schema_org_subsets.html
- recipe-scrapers repo (MIT, actively pushed 2026-10-18) — https://github.com/hhursev/recipe-scrapers
- recipe-scrapers on PyPI (15.13.0, released 2026-10-18; deps beautifulsoup4/extruct/isodate) — https://pypi.org/pypi/recipe-scrapers/json
- recipe-scrapers docs, supported sites (742 sites, `wild_mode`) — https://docs.recipe-scrapers.com/getting-started/supported-sites/
- npm registry metadata for `web-auto-extractor`, `microdata-node`, `@cucumber/microdata`, `schema-dts`, `cheerio`, `recipe-scraper` — https://registry.npmjs.org/
- Pinterest robots.txt (`User-agent: *` / `Disallow: /`) — https://www.pinterest.com/robots.txt

**Cloudflare**
- Workers platform limits (free: 100k req/day, 10 ms CPU, 50 subrequests, error 1027 on overage) — https://developers.cloudflare.com/workers/platform/limits/
- D1 limits — https://developers.cloudflare.com/d1/platform/limits/
- D1 pricing (free: 5M rows read/day, 100k rows written/day, 5 GB; hard stop on overage) — https://developers.cloudflare.com/d1/platform/pricing/
- Workers KV limits (free: 100k reads/day, 1,000 writes/day, 1 GB, 25 MiB value) — https://developers.cloudflare.com/kv/platform/limits/
- Workers Static Assets — https://developers.cloudflare.com/workers/static-assets/
- Static assets billing ("Requests to static assets are free and unlimited") — https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- HTMLRewriter — https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/
- Node.js compatibility matrix (`node:fs`, `node:net` supported) — https://developers.cloudflare.com/workers/runtime-apis/nodejs/
- Python Workers + package support (pure/PyEmscripten wheels) — https://developers.cloudflare.com/workers/languages/python/ , https://developers.cloudflare.com/workers/languages/python/packages/
- Workers Custom Domains (active zone required; certs issued automatically) — https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- Cloudflare Access for Workers (protects routes, Custom Domains, workers.dev hostname, previews) — https://developers.cloudflare.com/workers/configuration/cloudflare-access/
- Access pricing, Free plan "$0 forever… 50 user limit" — https://www.cloudflare.com/sase/products/access/
- Cloudflare One account limits (50 Access apps on Free/PAYG) — https://developers.cloudflare.com/cloudflare-one/account-limits/
- Pages limits (500 builds/month, 20,000 files, 25 MiB) — https://developers.cloudflare.com/pages/platform/limits/

**GitHub**
- GitHub Pages limits (1 GB site, 100 GB/month soft bandwidth, 10 builds/hour soft) — https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- GitHub Pages publish delay ("up to 10 minutes") — https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site
- GitHub Pages custom domains (CNAME to `user.github.io`) — https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages
- GitHub Pages HTTPS / Let's Encrypt, up to an hour, CAA requirement — https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https
- REST API rate limits (5,000/hr; 80 content-creating/min, 500/hr) — https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- REST API repository contents (PUT, base64 `content`, `sha`, serialise writes) — https://docs.github.com/en/rest/repos/contents

**Other platforms**
- Supabase pricing (500 MB DB, 5 GB egress, 2 active projects, pause after 1 week inactive) — https://supabase.com/pricing
- Supabase docs, Free Plan pausing ("low activity in a 7-day period") — https://supabase.com/docs/guides/platform/going-into-prod
- Vercel limits (Hobby: 100 deployments/day, 100 builds/hour, 300 s functions) — https://vercel.com/docs/limits
- Vercel fair use (Hobby: 100 GB transfer, 1M invocations; "restricted to non-commercial personal use only") — https://vercel.com/docs/limits/fair-use-guidelines
- Vercel KB, paused deployments — https://vercel.com/kb/guide/why-is-my-account-deployment-blocked
- Deno Deploy pricing (1M req/month, 20 GiB egress, 1 GiB KV, 10 deployments) — https://deno.com/deploy/pricing
- Val Town pricing (100k runs/day, 1 min wall clock) — https://www.val.town/pricing
- Val Town limits (0 custom domains on Free, 2,500 vals, 15-min crons) — https://www.val.town/limits

**Local inspection (this repo, 2026-10-20)**
- `dig NS citrons.me` → Namecheap nameservers; `dig recipies.citrons.me` → `flatbed-hook.github.io`
- `recipes/*.html` parsed to JSON: 16/16 clean, 22,783 bytes raw / 8,272 bytes gzipped
