import { requireAuth } from './login.js';

// Protected endpoint: lets the client check a stored token (it may be from a rotated password).
export const onRequestGet = async (context) => (await requireAuth(context)) ?? Response.json({ ok: true });
