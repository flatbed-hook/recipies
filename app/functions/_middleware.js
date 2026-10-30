import { requireAuth } from './api/login.js';

// Deny by default. requireAuth is opt-in, so a write endpoint is protected only if its author
// remembers to call it — this runs before all of them and rejects every unsafe method without a
// valid token, so a new endpoint is shut even if its author forgets.
//
// POST /api/login is the one exemption: it is how a token is obtained, so blocking it would lock
// the site for everyone, permanently. It does its own password check.
// ponytail: at the Functions root, so it is measured to run on static assets too — /styles.css
// and /auth.js each spend a Functions invocation instead of being served straight off the edge.
// Bought deliberately: it covers any future endpoint, not just the ones under /api. Move this
// file to functions/api/_middleware.js if that hop ever shows up in the request budget.
const SAFE = ['GET', 'HEAD'];

export const onRequest = async (context) => {
  const open = SAFE.includes(context.request.method) || (context.request.method === 'POST' && new URL(context.request.url).pathname === '/api/login');
  return open ? context.next() : ((await requireAuth(context)) ?? context.next());
};
