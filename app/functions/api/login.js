// The one shared edit password. It is a binding, never a value in this repository:
//   local dev / tests  ->  app/.dev.vars (gitignored):  EDIT_PASSWORD=whatever
//   production         ->  wrangler pages secret put EDIT_PASSWORD
// Rotating it needs no front-end redeploy, and invalidates every issued token.

const encode = (value) => new TextEncoder().encode(String(value));

const sha256 = async (value) => new Uint8Array(await crypto.subtle.digest('SHA-256', encode(value)));

// Length-independent: hashing both sides first makes every comparison 32 bytes, so neither the
// password nor the token leaks its length through timing. timingSafeEqual does the rest.
const matches = async (a, b) => crypto.subtle.timingSafeEqual(await sha256(a), await sha256(b));

const hex = (bytes) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

// The token is derived from the password, so nothing is stored server-side and rotating the
// password invalidates every token at once. It is stretched rather than a bare hash: a token
// that leaks (localStorage, a shared device) must not crack back to the password itself.
// ponytail: 25k iterations is ~3ms, chosen to stay inside the Workers free-tier 10ms CPU budget
// — raise it on a paid plan, or move to Cloudflare Access when per-user revocation matters.
const ITERATIONS = 25000;
let derived; // One isolate serves many requests; only the first pays the stretching cost.

const tokenFor = async (password) => {
  if (derived?.password !== password) {
    const key = await crypto.subtle.importKey('raw', encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = { name: 'PBKDF2', hash: 'SHA-256', salt: encode('recipes-token-v1'), iterations: ITERATIONS };
    derived = { password, token: hex(new Uint8Array(await crypto.subtle.deriveBits(bits, key, 256))) };
  }
  return derived.token;
};

export const onRequestPost = async ({ request, env }) => {
  const { password } = await request.json().catch(() => ({}));
  if (!env.EDIT_PASSWORD || !(await matches(password, env.EDIT_PASSWORD)))
    return Response.json({ error: 'Wrong password' }, { status: 401 });
  return Response.json({ token: await tokenFor(env.EDIT_PASSWORD) });
};

// The security boundary. Returns null when the request carries a valid token, otherwise the
// 401 to return instead. Write endpoints call this first; hiding buttons is only convenience.
export const requireAuth = async ({ request, env }) => {
  const token = (request.headers.get('Authorization') || '').match(/^Bearer (\S+)$/)?.[1];
  if (!env.EDIT_PASSWORD || !token || !(await matches(token, await tokenFor(env.EDIT_PASSWORD))))
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return null;
};
