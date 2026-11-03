#!/usr/bin/env bash
# _redirects is static config that the vitest seam cannot reach, so prove it against a real
# `wrangler pages dev` instead: every old /recipes/<slug>.html must land on the new recipe, and
# every extensionless /recipes/<slug> must still serve the detail shell directly.
set -uo pipefail
cd "$(dirname "$0")/.."

PORT=${PORT:-8788}
npx wrangler pages dev --port "$PORT" >/tmp/pages-dev.log 2>&1 &
trap 'kill $! 2>/dev/null' EXIT
until curl -fsS -o /dev/null "http://localhost:$PORT/"; do sleep 1; done

fail=0
check() { # check <url> <expected-status> <expected-final-path>
  read -r status url < <(curl -sL -o /dev/null -w '%{http_code} %{url_effective}' "http://localhost:$PORT$1")
  final=${url#http://localhost:$PORT}
  if [ "$status" = "$2" ] && [ "$final" = "$3" ]; then printf 'ok   %-78s %s %s\n' "$1" "$status" "$final"
  else printf 'FAIL %-78s %s %s (want %s %s)\n' "$1" "$status" "$final" "$2" "$3"; fail=1; fi
}

# Every one of the 16 original slugs, both the old .html address and the new extensionless one.
for slug in $(grep -o "VALUES ('[a-z0-9-]*'" seed.sql | sed "s/VALUES ('//;s/'//"); do
  check "/recipes/$slug.html" 200 "/recipes/$slug"   # old shared link -> canonical new URL
  check "/recipes/$slug" 200 "/recipes/$slug"        # already-working URL, must not regress
done
check /recipes/no-such-recipe 200 /recipes/no-such-recipe  # unknown slug still gets the shell

echo; [ $fail = 0 ] && echo "all redirect checks passed" || echo "redirect checks FAILED"
exit $fail
