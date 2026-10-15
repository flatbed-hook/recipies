---
description: Convert a recipe (text, image file, or URL) into a standard page and publish it to the recipes site
argument-hint: [recipe text, image file path, or URL]
allowed-tools: Bash(git:*), Bash(mkdir:*), Bash(cp:*), Bash(ls:*), Read, Write, Edit, WebFetch
---

You are adding a recipe to this GitHub Pages site. The input is: $ARGUMENTS

## Step 1: Get the recipe content
- If the input is a URL, use WebFetch to read the page. If it's a justtherecipe.com URL, skip it and fetch its `?url=` target directly instead — the proxy returns no content. Extract the full recipe: title, description, servings, times, ingredients, instructions, and notes. Record the site name and URL as the source only if they are clearly identified. If the source is unclear or missing, omit the source line entirely.
- If the input is an image file path, read the image and transcribe the full recipe. Use the image as the recipe photo only if it is a photo of the finished dish. Do not use a photo of the recipe card itself.
- If the input is text, use it as written. Clean up formatting, but keep all content.
- If the image was pasted into chat and has no file path, stop and ask the user to save it to a file and provide the path. Otherwise, transcribe the recipe and omit the photo.

## Step 2: Build the page
- Create a slug from the title: lowercase, words separated by hyphens, no punctuation (example: "Lemon Blueberry Muffins" becomes `lemon-blueberry-muffins`).
- If `recipes/<slug>.html` already exists, stop and tell the user.
- Category must be one of: Baking, Soups, Salads, Vegetarian, Other. Pick the best fit.
- Write `recipes/<slug>.html` using the TEMPLATE below. Replace every {{PLACEHOLDER}}. Delete any block marked OPTIONAL when its content is not available. Do not change the structure, class names, or order of sections, because every page must match.
- If there is a photo, copy it to `images/<slug>.<original-extension>` and use that filename in the template. Otherwise, delete the image line.

## Step 3: Add to the index
- In `index.html`, insert a new line directly after `<!-- RECIPES:START -->` using this format:
  `<li><a href="recipes/<slug>.html">Title</a><span class="cat">Category</span></li>`
- Keep the newest recipe at the top of the list.

## Step 4: Publish
1. Run `git status --porcelain`. If it shows uncommitted changes that you did not make, stop and tell the user.
2. Run `git pull --rebase origin main`.
3. Run `git add recipes/<slug>.html images/<file> index.html` (leave out the image if there isn't one).
4. Run `git commit -m "Add recipe: <Title>"`.
5. Run `git push origin main`.
6. Report the live URL: https://flatbed-hook.github.io/recipies/recipes/<slug>.html (GitHub Pages can take about a minute to update).

If any git command fails, stop and show the error. Do not force-push.

## TEMPLATE (use exactly this structure)

<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{TITLE}} | Recipes</title>
<link rel="stylesheet" href="../styles.css">
</head>
<body>
<header class="site-header"><a href="../index.html">← All Recipes</a></header>
<main>
<h1>{{TITLE}}</h1>
<p class="description">{{DESCRIPTION}}</p>
<!-- OPTIONAL: include only if the description exists -->
<ul class="meta">
<li><strong>Category:</strong> {{CATEGORY}}</li>
<li><strong>Servings:</strong> {{SERVINGS}}</li>
<li><strong>Prep time:</strong> {{PREP_TIME}}</li>
<li><strong>Cook time:</strong> {{COOK_TIME}}</li>
</ul>
<!-- OPTIONAL: include only if a photo exists -->
<img class="recipe-image" src="../images/{{IMAGE_FILE}}" alt="{{TITLE}}">
<h2>Ingredients</h2>
<ul class="ingredients">
<li>{{INGREDIENT}}</li>
</ul>
<h2>Instructions</h2>
<ol class="steps">
<li>{{STEP}}</li>
</ol>
<!-- OPTIONAL: include only if notes exist -->
<h2>Notes</h2>
<p>{{NOTES}}</p>
<!-- OPTIONAL: include only if a clearly identified source exists -->
<footer class="source">Source: <a href="{{SOURCE_URL}}">{{SOURCE_NAME}}</a></footer>
</main>
</body>
</html>
