import { requireAuth } from './api/login.js';

// Deny by default. requireAuth is opt-in, so a write endpoint is protected only if its author
// remembers to call it — this runs before all of them and rejects every unsafe method without a
// valid token, so a new endpoint is shut even if its author forgets.
//
// POST /api/login is the one exemption: it is how a token is obtained, so blocking it would lock
// the site for everyone, permanently. It does its own password check.
const SAFE = ['GET', 'HEAD'];

export const onRequest = async (context) => {
  const open = SAFE.includes(context.request.method) || (context.request.method === 'POST' && new URL(context.request.url).pathname === '/api/login');
  return open ? context.next() : ((await requireAuth(context)) ?? context.next());
};
